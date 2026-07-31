-- Double opt-in for property-request match alerts (closes run-p5-requests P3).
--
-- Owner decision 2026-07-31: nobody gets match alerts until the mailbox owner has
-- confirmed the request. The confirmation token is the request row's uuid — the same
-- decision already made for unsubscribe (20260731070000 §3): unguessable, known only to
-- the address the mail went to, and to staff, who hold strictly stronger powers anyway.
--
-- Documented residual, accepted by the run's review panel: the anon INSERT surface lets
-- a direct PostgREST caller supply his own row id and then confirm it himself, because
-- the server action and a direct API caller share the anon role — there is no server
-- credential in this app to tell them apart (deliberate posture: the service_role key is
-- nowhere in the deployment). Such an attacker gains exactly what every submitter had
-- BEFORE this feature (alerts start without the mailbox owner's consent), now bounded
-- tighter by the caps below, each alert carrying an unsubscribe link. The browser flow —
-- the product path — is genuinely double opt-in. A future hardening pass may move the
-- token server-side behind a privileged credential; until then this comment is the record.

-- ---------------------------------------------------------------------------
-- 1. The confirmation flag. NULL = unconfirmed; set once by the RPC below and
--    never reverting. The table is empty on live (verified at plan time), so
--    there is nothing to backfill or grandfather.
-- ---------------------------------------------------------------------------

alter table public.property_requests
  add column if not exists confirmed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Public inserts may not arrive pre-confirmed. Narrowing only: same policy,
--    same roles, one extra conjunct. Staff inserts (tests, tooling) pass via
--    the separate property_requests_staff_write policy, which is untouched.
-- ---------------------------------------------------------------------------

drop policy if exists property_requests_insert_valid on public.property_requests;
create policy property_requests_insert_valid on public.property_requests
  for insert to anon, authenticated
  with check (
    (profile_id is null or profile_id = (select auth.uid()))
    and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and confirmed_at is null
  );

-- ---------------------------------------------------------------------------
-- 3. Throttle: the two hourly caps stay; two 180-day caps join them. 180 days
--    is the alert-candidacy window (match-alerts CANDIDATE_WINDOW_DAYS) — rows
--    older than that can never alert, so they stop counting against anybody.
--
--    * >= 3 unconfirmed rows for one address: a bombing victim receives at most
--      three confirmation emails, ever, until one is confirmed — and a legit
--      visitor whose confirmation mail went astray gets two more tries.
--    * >= 5 open (un-handled) rows for one address: bounds how many standing
--      alert-producing rows any address can accumulate, whoever created them.
--      Unsubscribe and the staff queue both set is_handled and free slots.
--
--    The messages differ so the server log names the cap that fired; the action
--    maps every one of them to the same visitor-facing sentence.
-- ---------------------------------------------------------------------------

create or replace function public.throttle_property_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
  recent_total integer;
  unconfirmed integer;
  open_rows integer;
begin
  select count(*) into recent
    from public.property_requests r
   where lower(r.email) = lower(new.email)
     and r.created_at > now() - interval '1 hour';

  if recent >= 3 then
    raise exception 'Too many property requests from this email address in the last hour.'
      using errcode = 'check_violation';
  end if;

  select count(*) into recent_total
    from public.property_requests r
   where r.created_at > now() - interval '1 hour';

  if recent_total >= 30 then
    raise exception 'Property requests are briefly paused.'
      using errcode = 'check_violation';
  end if;

  select count(*) into unconfirmed
    from public.property_requests r
   where lower(r.email) = lower(new.email)
     and r.confirmed_at is null
     and r.created_at > now() - interval '180 days';

  if unconfirmed >= 3 then
    raise exception 'Earlier requests from this address are awaiting confirmation.'
      using errcode = 'check_violation';
  end if;

  select count(*) into open_rows
    from public.property_requests r
   where lower(r.email) = lower(new.email)
     and not r.is_handled
     and r.created_at > now() - interval '180 days';

  if open_rows >= 5 then
    raise exception 'This address already has several open requests.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Replaced in place; the trigger and the execute revocations (20260729131011)
-- survive a CREATE OR REPLACE untouched.

-- ---------------------------------------------------------------------------
-- 4. Confirm. Mirrors unsubscribe_property_request exactly: definer because
--    anon may not UPDATE the table, void either way so the endpoint cannot be
--    used to probe which ids exist, idempotent (a second confirm changes
--    nothing, and the original timestamp survives). The 180-day window matches
--    alert candidacy — a token older than that would confirm a row that can
--    never alert, so it simply stops working.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_property_request(req_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.property_requests
     set confirmed_at = now()
   where id = req_id
     and confirmed_at is null
     and created_at > now() - interval '180 days';
$$;

revoke execute on function public.confirm_property_request(uuid) from public;
grant execute on function public.confirm_property_request(uuid) to anon;
grant execute on function public.confirm_property_request(uuid) to authenticated;
