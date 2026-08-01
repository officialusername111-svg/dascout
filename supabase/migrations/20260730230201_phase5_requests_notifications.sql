-- Phase 5: the request form goes live and match alerts start sending. Two changes.
--
-- 1) The insert throttle gains a global circuit breaker. The existing 3-per-hour cap is
--    keyed to the submitted email, so a bot rotating addresses walks straight past it and
--    every insert becomes a notification email to the team inbox. Thirty rows an hour
--    across the whole table is far beyond any real demand for a twelve-listing site, and
--    when the breaker trips the form degrades to a generic message while staff keep
--    working. The messages differ per cap so the server log says which one fired; the
--    client is shown a uniform response either way (the action maps both to the same
--    text). Per-address/IP rate limiting at the edge remains the documented gap, same as
--    listing_views.
--
-- 2) A sent-ledger for match alerts. `transitionListing` may flip the same listing to
--    live more than once (withdraw → relist is legal), and an alert email must not be
--    sent twice for the same (request, listing) pair. A row is inserted before sending;
--    `sent_at` is set only after Resend accepts the message, so a send that failed (or
--    was skipped because no API key is configured yet) stays NULL and is retried on the
--    next publish of that listing. Staff-only: buyers never read this table, and only
--    the staff-session server code writes it.

-- ---------------------------------------------------------------------------
-- 1. Throttle: keep the per-email cap, add the global breaker.
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

  return new;
end;
$$;

-- The function is replaced in place; the trigger and the earlier execute revocations
-- (20260729131011) survive a CREATE OR REPLACE untouched.

-- ---------------------------------------------------------------------------
-- 2. The alerts sent-ledger.
-- ---------------------------------------------------------------------------

create table if not exists public.request_match_alerts (
  request_id uuid not null references public.property_requests (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- NULL until Resend accepts the message; the retry query keys on this.
  sent_at timestamptz,
  primary key (request_id, listing_id)
);

alter table public.request_match_alerts enable row level security;

drop policy if exists request_match_alerts_staff_all on public.request_match_alerts;
create policy request_match_alerts_staff_all
  on public.request_match_alerts
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- The retry path ("which matched requests for this listing are still unsent?") and the
-- lifetime cap ("how many alerts has this request ever produced?") both read by one side
-- of the composite key; the PK covers request_id, this covers listing_id.
create index if not exists request_match_alerts_listing_idx
  on public.request_match_alerts (listing_id);

-- ---------------------------------------------------------------------------
-- 3. Unsubscribe. An anonymous requester has no account to sign in with, so the only
--    way to stop their alerts is the link in the email itself. The token is the request
--    row's uuid — unguessable, known only to the address that received the mail (and to
--    staff, who can already toggle is_handled). The function is definer because anon may
--    not UPDATE the table, and it flips exactly one flag on exactly one row. It returns
--    void whether or not the id existed: the caller's page says the same thing either
--    way, so the endpoint cannot be used to probe which ids exist.
-- ---------------------------------------------------------------------------

create or replace function public.unsubscribe_property_request(req_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.property_requests
     set is_handled = true
   where id = req_id;
$$;

revoke execute on function public.unsubscribe_property_request(uuid) from public;
grant execute on function public.unsubscribe_property_request(uuid) to anon;
grant execute on function public.unsubscribe_property_request(uuid) to authenticated;
