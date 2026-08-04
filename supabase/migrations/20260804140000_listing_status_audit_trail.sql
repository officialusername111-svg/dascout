-- listing approval workflow refinement (piece 4 of docs/BRIEF-listing-encoding-v2.md §7)
--
-- WHAT THIS IS FOR. The submit/approve MECHANISM already exists and is live
-- (guard_listing_publish, the admin action bar) — the brief's §3 transition rules and the
-- "any listing admin may approve including their own work" decision are settled, not
-- touched here. What is missing, confirmed by grep across every prior migration before
-- writing this file: there is no record of WHO moved a listing through that graph, or
-- WHEN, beyond the bare `updated_at` timestamp. The brief's own opening line frames this
-- whole effort as "mirroring the admin-account approval queue built in
-- run-p9-invite-approval-queue" — that queue's audit table is `admin_role_changes`
-- (20260802131500), and this table is built on the same shape.
--
-- WHY A GENERIC STATUS-CHANGE LOG, NOT AN "APPROVALS ONLY" TABLE. The brief's title for
-- this piece is "submit -> approve", but a table that only logged that one transition
-- would need extending again the next time someone asks "who withdrew this" or "who
-- marked this sold" — both are the same shape of question. `price_history` (the other
-- audit trail on this table, 20260727163635) already logs every price change generically
-- rather than "big cuts only"; this follows the same instinct for status.
--
-- WHY APPEND-ONLY BY CONSTRUCTION, NOT BY CONVENTION (matching admin_role_changes'
-- reasoning verbatim). This is an accountability record. Unlike `price_history`, which
-- grants staff a defensive direct-write ALL policy alongside its trigger, this table
-- takes admin_role_changes' STRICTER shape: no INSERT/UPDATE/DELETE policy and no such
-- grant for anybody, staff included — the SECURITY DEFINER trigger below is the only
-- writer. A record of who approved what is worth nothing if the approver's own session
-- could edit it afterward.
--
-- WHY A TRIGGER, NOT A CALL INSIDE THE EXISTING TRANSITION ACTION. `transitionListing` in
-- web/app/admin/actions.ts is one of at least two paths that can move `status` (the other
-- being any direct PostgREST UPDATE a future feature might issue, exactly as
-- guard_listing_publish already assumes when it enforces the graph at the database rather
-- than trusting the app to always call the right function). A trigger on the column
-- itself, mirroring `record_price_change`, catches every path by construction instead of
-- by every caller remembering to log it.
--
-- READ ACCESS: is_staff(), not is_super_admin(). Any listing admin may already approve a
-- listing (brief §3) — restricting who may SEE that record to a narrower group than who
-- may CREATE one would be backwards. admin_role_changes uses is_super_admin() because only
-- a super admin manages admin accounts at all; listings are a staff-wide surface.
--
-- NO EXPLICIT BEGIN/COMMIT — same reasoning as every other migration in this project: one
-- implicit transaction, all-or-nothing as written.

-- ---------------------------------------------------------------------------
-- 1. The audit table.
--
--    from_status is nullable for the one case with nothing to compare against: a listing's
--    birth row. guard_listing_publish already refuses an INSERT with status in
--    ('live','sold'), so in practice the birth row is always 'list' — logged anyway, so
--    "when was this listing created, by whom" is answerable from the same table rather
--    than falling back to created_at/created_by on listings itself.
--
--    listing_id is ON DELETE CASCADE, matching every other per-listing audit table
--    (price_history, listing_photos, listing_features) — the trail belongs to the listing
--    and has no meaning once it is gone. actor_id is ON DELETE SET NULL, matching
--    admin_role_changes exactly: the record of what was done must outlive the account that
--    did it.
-- ---------------------------------------------------------------------------

create table public.listing_status_changes (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  from_status public.listing_status,
  to_status   public.listing_status not null,
  changed_at  timestamptz not null default now()
);

create index listing_status_changes_listing_idx
  on public.listing_status_changes (listing_id, changed_at desc);

alter table public.listing_status_changes enable row level security;

revoke all    on table public.listing_status_changes from anon, authenticated;
grant  select on table public.listing_status_changes to   authenticated;

create policy listing_status_changes_staff_read on public.listing_status_changes
  for select to authenticated
  using (public.is_staff());

-- ---------------------------------------------------------------------------
-- 2. The trigger. Fires on the same column list guard_listing_publish already gates
--    (`insert or update of status`), so both functions see exactly the same set of writes
--    — this one records what that one permits.
--
--    THE EARLY RETURN MATTERS HERE TOO, same reasoning as guard_listing_publish's own
--    no-op guard: an ordinary save that posts the same status it read (`update of status`
--    fires on any UPDATE whose SET list mentions the column, changed or not) must not
--    write a row that claims a change nothing made.
-- ---------------------------------------------------------------------------

create or replace function public.record_listing_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.listing_status_changes (listing_id, from_status, to_status, actor_id)
    values (new.id, null, new.status, (select auth.uid()));
  elsif old.status is distinct from new.status then
    insert into public.listing_status_changes (listing_id, from_status, to_status, actor_id)
    values (new.id, old.status, new.status, (select auth.uid()));
  end if;
  return new;
end;
$$;

revoke execute on function public.record_listing_status_change() from public, anon, authenticated;

create trigger listings_record_status_change
  after insert or update of status on public.listings
  for each row
  execute function public.record_listing_status_change();

-- ---------------------------------------------------------------------------
-- 3. Post-migration assertions.
-- ---------------------------------------------------------------------------

do $$
declare
  n_policy  bigint;
  n_grant   bigint;
  n_trigger bigint;
begin
  select count(*) into n_policy
    from pg_policy
   where polrelid = 'public.listing_status_changes'::regclass;
  if n_policy <> 1 then
    raise exception 'expected exactly 1 RLS policy on listing_status_changes, found %', n_policy;
  end if;

  select count(*) into n_grant
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'listing_status_changes'
     and grantee in ('anon', 'authenticated')
     and privilege_type <> 'SELECT';
  if n_grant <> 0 then
    raise exception 'anon/authenticated hold a non-SELECT privilege on listing_status_changes (% found) — the table is not append-only', n_grant;
  end if;

  select count(*) into n_trigger
    from pg_trigger
   where tgrelid = 'public.listings'::regclass and tgname = 'listings_record_status_change';
  if n_trigger <> 1 then
    raise exception 'listings_record_status_change trigger did not attach';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Backfill note, deliberately NOT done. Every listing that existed before this
--    migration has no birth row and no history of its prior transitions — there is
--    nothing to reconstruct them from (no prior audit table logged status changes, and
--    `updated_at` is overwritten on every save, not just status moves). History starts
--    from this migration forward; a listing's current status remains fully correct
--    either way, only the trail before this date is unavailable.
--
-- 5. Post-apply verification. Safe to re-run at any time.
--
--    a. change any listing's status through the admin UI, then:
--         select * from listing_status_changes where listing_id = '<that id>'
--          order by changed_at desc limit 1;
--       expect one new row, actor_id = your own profile id, to_status = what you set it to.
--
--    b. an ordinary save that does not touch status writes nothing:
--         select count(*) from listing_status_changes; -- note the count
--       edit a listing's price only, save, re-run the count query — expect it unchanged.
--
--    c. anon cannot read it at all:
--         (as anon) select * from listing_status_changes limit 1;
--       expect a permission error, not zero rows.
-- ---------------------------------------------------------------------------
