-- listing encoding v2 — APPLY 2 of 3 (the admin-only one)
--
-- Spec: docs/BRIEF-listing-encoding-v2.md. Section 8b wins over sections 1-9; this file
-- implements row 2 of 8b's D5 table and nothing else.
--
-- WHAT THIS APPLY IS FOR. Three things, in this order:
--   1. rename TWO listing_status values — draft -> list, verifying -> for_approval;
--   2. replace guard_listing_publish so the lifecycle graph is enforced by the database
--      instead of by the verification trail that is about to be deleted;
--   3. carry one real row's meaning into listing_features, then drop verification_events
--      and the verification_kind enum with it.
--
-- WHAT BREAKS, AND FOR HOW LONG (8b D5). Admin only: listing creation, the status tabs,
-- the transition buttons and the listing detail page. The PUBLIC SITE IS UNTOUCHED —
-- `live`, `sold` and `withdrawn` keep their stored names, so the eleven RLS policies,
-- top_listings(), sync_listing_timestamps(), every .eq('status','live') in
-- web/lib/queries.ts, app/sitemap.ts and lib/match-alerts.ts never enter the blast radius
-- (8b D1). The matching code deploy must land within minutes of this file; schedule
-- outside working hours.
--
-- ZERO PRODUCTION ROWS MOVE. All 12 listings are `live`. The rename touches labels in
-- pg_enum, not data pages, and it is O(1) — no table is rewritten and no index is
-- rebuilt. `listings.status` keeps its column default: the default expression stores the
-- enum VALUE, not its text, so renaming the label re-renders the default as 'list'
-- automatically.
--
-- ON THE WORD "VERIFIED" (8b D10). Deleting verification_events does NOT retract the
-- title-verified claim. "Title-verified by DaScout" stays in public page metadata, the
-- home page VerifiedBand and the alert emails, and apply 1 added an "All documents
-- Verified" FEATURE. A paperwork claim about a property is not a workflow step about a
-- listing; the removal is deliberate and complete, not half-finished.
--
-- THE GRANT RULE (8b D7). This file changes no grant. Dropping a table takes its grants
-- with it, which is a narrowing — so the code that stops reading verification_events must
-- be deployed at the same time, not after. That is the whole reason this apply is
-- scheduled rather than routine.
--
-- NO EXPLICIT BEGIN/COMMIT. The file is sent as one batch, which Postgres already runs
-- inside a single implicit transaction — it is all-or-nothing as written. An explicit
-- COMMIT here would instead end the caller's own transaction out from under it.

-- ---------------------------------------------------------------------------
-- 1. The status rename. TWO values, and only two (8b D1/D2).
--
--    Machine labels, not display strings: the enum carries `list` and `for_approval`,
--    never `List` / `For Approval`. These values land in query strings (?status=list),
--    in PostgREST filters (status=eq.for_approval) and in every test fixture; a space or
--    a capital would be percent-encoded into all three. The screen still reads "For
--    Approval" through STATUS_LABELS in web/lib/admin/queries.ts (8b D2).
--
--    `live`, `sold` and `withdrawn` are deliberately NOT renamed. See the header.
--
--    ALTER TYPE ... RENAME VALUE is transaction-safe and does not create a new enum OID,
--    so the new labels are usable later in this same transaction (unlike ADD VALUE).
-- ---------------------------------------------------------------------------

alter type public.listing_status rename value 'draft'     to 'list';
alter type public.listing_status rename value 'verifying' to 'for_approval';

-- ---------------------------------------------------------------------------
-- 2. guard_listing_publish, redesigned (8b D6).
--
--    WHY IT IS NOT SIMPLY DROPPED. The old body did four things; two of them had nothing
--    to do with verification and have to survive: refusing an INSERT straight into a
--    public status, and refusing `-> sold` from anywhere but `live`. And removing the
--    events requirement without replacing it would remove the only DATABASE-side thing
--    stopping a direct PostgREST call flipping a listing from `list` to `live`, skipping
--    approval entirely — staff RLS on `listings` is FOR ALL, and the transition graph
--    otherwise lives only in TypeScript. So the guard gains the graph.
--
--    THE MATRIX IS A PORT, NOT A NEW DESIGN. It is TRANSITIONS in
--    web/lib/admin/queries.ts, value for value, with the two renamed keys:
--      list         -> for_approval
--      for_approval -> list, live
--      live         -> sold, withdrawn
--      sold         -> (nothing; terminal)
--      withdrawn    -> live
--    Two properties the old code had as side effects fall out of it for free: `sold` is
--    reachable only from `live`, and `withdrawn -> live` relists WITHOUT passing approval
--    again. That second one is named-and-kept on purpose (8b D10) — the owner's table
--    says Withdrawn merely hides a listing — and it is the one way around the approval
--    gate. Do not "fix" it here; it would diverge from the app graph and break relisting.
--
--    THE EARLY RETURN IS THE PART THAT KEEPS THE ADMIN UP (8b D6). This trigger is
--    `before insert or update of status`, so it fires on ANY update whose SET list
--    mentions status — including an ordinary form save that posts the same value it read.
--    Under the old body such a save fell through every branch harmlessly. Under a matrix,
--    `list -> list` is not an edge, so without this guard every routine save on every
--    listing would start raising the moment this file is applied. That is the single
--    failure this section exists to prevent.
--
--    NO VERIFICATION_EVENTS, IN EITHER DIRECTION. The old body also INSERTED a `published`
--    row on every `-> live`. That insert goes away with the table and has no replacement:
--    nothing reads those rows, `listings.published_at` is still stamped by
--    sync_listing_timestamps(), and the admin's own audit needs are met by
--    admin_role_changes and price_history. Statutory listing data is unaffected.
--
--    security definer + pinned search_path are kept from the original, matching the
--    throttle_property_requests idiom. The guard no longer reads any table, but a trigger
--    whose correctness depends on the caller's grants is the wrong shape regardless.
-- ---------------------------------------------------------------------------

create or replace function public.guard_listing_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if tg_op = 'INSERT' then
    -- There is no legitimate insert-as-public path. The app always inserts `list`.
    if new.status in ('live', 'sold') then
      raise exception
        'Listing % cannot be created directly in status %; create it as a List entry and take it through For Approval.',
        new.id, new.status
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- The no-op save. Read the section header before removing this.
  if old.status is not distinct from new.status then
    return new;
  end if;

  v_allowed := case old.status
    when 'list'         then new.status = 'for_approval'
    when 'for_approval' then new.status in ('list', 'live')
    when 'live'         then new.status in ('sold', 'withdrawn')
    when 'sold'         then false
    when 'withdrawn'    then new.status = 'live'
    else false
  end;

  if not v_allowed then
    raise exception
      'Listing % cannot move from % to %.',
      new.id, old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Default PUBLIC EXECUTE is revoked for hygiene (repo precedent:
-- restrict_is_staff_execute). A trigger function is not directly callable anyway;
-- grants should still say what we mean.
revoke execute on function public.guard_listing_publish() from public, anon, authenticated;

-- Recreated rather than left in place: `create or replace function` keeps the existing
-- trigger pointed at the new body, but restating the trigger makes the timing and the
-- column list visible in this file rather than only in the 2026-07-29 one.
drop trigger if exists guard_listing_publish on public.listings;
create trigger guard_listing_publish
  before insert or update of status on public.listings
  for each row
  execute function public.guard_listing_publish();

-- ---------------------------------------------------------------------------
-- 3. Carry the one real verification row forward BEFORE the table is dropped.
--
--    verification_events holds exactly one row that records real work: a `title_check`
--    performed on property 012, "Villa Consuelo Modern Home", on 2026-08-02. Dropping the
--    table without doing anything with it would silently discard the only genuine datum
--    in it. The owner's decision (in chat, 2026-08-03, immediately before this apply) is
--    that the paperwork claim survives as a FEATURE — which is what a buyer actually sees
--    — rather than as a workflow record nothing reads.
--
--    The feature row itself already exists: apply 1 seeded "All documents Verified"
--    (slug all-documents-verified) in its three-new-features batch. Property 012 carries
--    only "Near highway" and "Road access" today, confirmed by direct SQL before writing
--    this, so this insert adds a third link and changes nothing else.
--
--    ON CONFLICT DO NOTHING on the composite primary key (listing_id, feature_id) makes
--    the statement idempotent: re-running this migration, or an encoder having ticked the
--    box by hand in the meantime, both land as a no-op rather than a 23505.
-- ---------------------------------------------------------------------------

insert into public.listing_features (listing_id, feature_id)
values (
  '14be6d23-f555-4f0f-ab8d-ea9cc84b4bd3',  -- listing: property 012, Villa Consuelo Modern Home
  'c6544e95-5c92-4e4e-86a3-6dfd8ea21ef7'   -- feature: All documents Verified
)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Drop verification_events, and the enum that existed only to type it.
--
--    WHAT GOES WITH IT, deliberately: the two RLS policies from
--    20260729233300_tighten_verification_events_policies.sql (select + insert; there was
--    never an update or delete policy, which is what made the table append-only), the
--    listing_idx index, and both foreign keys.
--
--    THE FK IS THE POINT OF DROPPING RATHER THAN EMPTYING. verification_events.listing_id
--    is ON DELETE RESTRICT, so a test listing that ever acquired an event became
--    permanently undeletable by staff — the "zz-residue" problem that has left fixtures
--    behind on this project since July. Dropping the table closes it for good; every
--    remaining FK into listings is ON DELETE CASCADE.
--
--    verification_kind is NOT dropped, on discovery during apply: an unqualified drop was
--    attempted and Postgres correctly refused (2BP01) because
--    cleanup_backup.verification_events_20260801 — the backup table from the 2026-08-02
--    test-cleanup pass, tracked as its own open item ("drop schema cleanup_backup cascade;
--    when satisfied") — still has a column typed verification_kind. Forcing a CASCADE here
--    would reach into that backup schema as a side effect of an unrelated migration, which
--    is exactly the kind of surprise a migration file should never spring. Same shape as
--    8b D4's listing_category: an unused enum survives this run rather than being fought
--    over, which is the safest state available. Revisit when cleanup_backup is dropped.
-- ---------------------------------------------------------------------------

drop table if exists public.verification_events;

-- ---------------------------------------------------------------------------
-- 5. Post-migration assertions. Same shape as apply 1's backfill check: this block
--    RAISES, so a migration that did not do what it says never commits.
-- ---------------------------------------------------------------------------

do $$
declare
  n_new     bigint;
  n_old     bigint;
  n_feature bigint;
begin
  select count(*) into n_new
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
   where t.typname = 'listing_status'
     and e.enumlabel in ('list', 'for_approval');
  if n_new <> 2 then
    raise exception 'status rename incomplete: expected labels list and for_approval, found % of 2', n_new;
  end if;

  select count(*) into n_old
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
   where t.typname = 'listing_status'
     and e.enumlabel in ('draft', 'verifying');
  if n_old <> 0 then
    raise exception 'status rename incomplete: % old label(s) (draft/verifying) still exist', n_old;
  end if;

  if to_regclass('public.verification_events') is not null then
    raise exception 'verification_events still exists';
  end if;

  -- verification_kind is deliberately left in place; see the section-4 comment.

  select count(*) into n_feature
    from public.listing_features lf
    join public.features f on f.id = lf.feature_id
   where lf.listing_id = '14be6d23-f555-4f0f-ab8d-ea9cc84b4bd3'
     and f.slug = 'all-documents-verified';
  if n_feature <> 1 then
    raise exception
      'property 012 does not carry the all-documents-verified feature (found % link(s)) — the one real verification row was not carried forward',
      n_feature;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Post-apply verification. Run these by hand afterwards; each should come back as
--    stated. They are queries, not assertions, so they are safe to re-run at any time.
--
--    a. the enum reads as expected:
--         select unnest(enum_range(null::public.listing_status));
--       expect  list, for_approval, live, sold, withdrawn  (in that order)
--
--    b. every listing still holds a valid status and nothing moved:
--         select status, count(*) from public.listings group by status;
--       expect  live = 12, nothing else
--
--    c. the column default followed the rename:
--         select column_default from information_schema.columns
--          where table_schema='public' and table_name='listings' and column_name='status';
--       expect  'list'::listing_status
--
--    d. an ordinary save on a live listing still works — THE regression this apply is
--       most likely to cause. From the admin, open any live listing, change nothing but
--       the description, save. Expect success, not "cannot move from live to live".
--
--    e. the approval gate holds at the database, not just in the app:
--         update public.listings set status = 'live'
--          where status = 'list' returning id;   -- expect: raises check_violation
--
--    f. the public site still answers. Load the home page, one property page and
--       /sitemap.xml. Nothing here changes what they read, so a failure means something
--       else — but check.
--
-- 7. Rollback. INCOMPLETE BY NATURE, and that is why apply 2 is scheduled.
--
--    The status rename and the guard reverse cleanly. `verification_events` does NOT:
--    dropping a table destroys its rows, and this project has no dump of them. The one
--    row that mattered is preserved as a listing_features link by section 3 and survives
--    any rollback of the rest. If the events table is ever genuinely needed again it must
--    be recreated from 20260727163606 §verification_events plus 20260729233300, and it
--    will come back empty.
--
--    begin;
--      alter type public.listing_status rename value 'list'         to 'draft';
--      alter type public.listing_status rename value 'for_approval' to 'verifying';
--      -- then restore guard_listing_publish from
--      -- 20260729233249_add_publish_guard_trigger.sql verbatim. NOTE: that body inserts
--      -- into verification_events on -> live and will fail until the table is back, so a
--      -- partial rollback must restore the table first or use the matrix body above with
--      -- the old names.
--    commit;
-- ---------------------------------------------------------------------------
