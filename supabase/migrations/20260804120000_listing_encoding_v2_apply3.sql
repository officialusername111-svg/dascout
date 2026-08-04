-- listing encoding v2 — APPLY 3 of 3 (the point of no return)
--
-- Spec: docs/BRIEF-listing-encoding-v2.md. Section 8b's D5 table, row 3: "property_type_id
-- set NOT NULL, drop listings.category". Piece 3 (the chip picker, frontage field, status
-- moved off the encoding form — commit dd0f565) was the last app-code blocker; this file
-- was deliberately not written until piece 3 was live, per D5's "later release" framing.
--
-- WHAT THIS APPLY IS FOR, IN ORDER:
--   1. drop the two-way sync trigger between category and property_type_id — it has
--      nothing left to sync once category is gone;
--   2. make property_type_id NOT NULL — every one of the 18 current listings already
--      carries one (verified by direct query immediately before writing this file, not
--      trusted from any handoff doc — see the two-root-path/schema-trust lesson in
--      docs/HANDOFF-2026-08-04.md §5);
--   3. drop listings.category itself, and the two CHECK constraints and the index that
--      exist only because of it.
--
-- THE OUTAGE SHAPE THIS APPLY COULD HAVE (D7), AND WHY IT DOESN'T HAPPEN HERE. D7's rule is
-- "grants that widen may land before the code; anything that narrows must land after it."
-- Dropping a column the live site selects is a narrowing change of exactly that kind — the
-- 2026-08-02 anon-grant apply took the site down for ~10 minutes by landing before its
-- code (see memory dascout-handoff-aug2-evening). This apply avoids repeating that: the new
-- code (web/lib/queries.ts, web/lib/admin/queries.ts, web/lib/match-alerts.ts) was written,
-- tested and DEPLOYED FIRST. It reads property_type_id and the property_types join
-- exclusively and never selects listings.category, so it already runs correctly against
-- today's schema, before this file touches anything. This migration is applied only after
-- that deploy is confirmed live — so there is no window where deployed code depends on a
-- column this file has removed.
--
-- WHY THE TRIGGER MUST GO FIRST, NOT LAST. sync_listing_property_type() reads and writes
-- new.category / old.category in its body. plpgsql does not check that a referenced column
-- still exists until the trigger actually FIRES — so if the column were dropped while the
-- trigger stayed attached, the very next insert or update on listings would raise "record
-- new has no field category" and take the admin down. Dropping the trigger (and the
-- function) before the column removes that failure mode entirely rather than racing it.
--
-- legacy_category_of(uuid) is dropped alongside it: its only caller was
-- sync_listing_property_type(), confirmed by a direct search of every function body in
-- `public` for the literal "category" immediately before writing this file.
--
-- listing_category THE ENUM IS NOT DROPPED (D4). property_requests.category still uses it,
-- and retiring the request-property function is its own open item (piece 7, not this one).
-- Same shape as apply 2's verification_kind: an unused-by-listings-but-still-referenced
-- enum survives rather than being fought over.
--
-- THE PUBLIC ?cat= SYSTEM IS UNCHANGED (§9 "Split", chosen here). §9 left open whether the
-- public category set becomes fully dynamic (any property type, any time) or stays the
-- fixed five behind a join. This apply keeps it fixed: web/lib/categories.ts's five
-- CATEGORY_KEYS, and every ?cat=rlot / ?cat=farm / ... bookmark, keep working exactly as
-- before, now sourced through property_types.legacy_category instead of the raw column. A
-- property type added after this migration with no legacy_category mapping is publicly
-- visible (it has a real name and photos) but is not reachable through ?cat= and does not
-- join the Lots/Buildings nav groups — this was already true today (D10) and does not
-- change. Making the public category set fully dynamic is a real product decision with its
-- own UI work; it was not asked for here and this file does not make it.
--
-- NO EXPLICIT BEGIN/COMMIT — same reasoning as apply 2: the file is sent as one batch,
-- already one implicit transaction.

-- ---------------------------------------------------------------------------
-- 1. Drop the sync trigger and the two functions that existed only to serve it.
-- ---------------------------------------------------------------------------

drop trigger if exists listings_sync_property_type on public.listings;
drop function if exists public.sync_listing_property_type();
drop function if exists public.legacy_category_of(uuid);

-- ---------------------------------------------------------------------------
-- 2. property_type_id becomes required. Verified immediately before this file was written:
--    0 of 18 listings have a null property_type_id (apply 1's backfill plus every listing
--    created since has kept it that way).
-- ---------------------------------------------------------------------------

alter table public.listings
  alter column property_type_id set not null;

-- ---------------------------------------------------------------------------
-- 3. Drop listings.category. Postgres drops, without CASCADE, the objects that exist
--    solely because of this column:
--      - CHECK listings_category_required_when_public
--          ((category IS NOT NULL) OR (status <> ALL ('{live,sold}')))
--      - CHECK listings_type_identified
--          ((category IS NOT NULL) OR (property_type_id IS NOT NULL))
--        (moot regardless: property_type_id is now NOT NULL, so this check could never
--        fail again even if it survived)
--      - index listings_category_idx
--    All three were confirmed to reference only this column by direct query before writing
--    this file — nothing else needed an explicit DROP first.
-- ---------------------------------------------------------------------------

alter table public.listings
  drop column category;

-- ---------------------------------------------------------------------------
-- 4. Post-migration assertions. Same shape as apply 1 and apply 2: this block RAISES, so a
--    migration that did not do what it says never commits.
-- ---------------------------------------------------------------------------

do $$
declare
  n_null_type   bigint;
  n_has_column  bigint;
  n_trigger     bigint;
  n_func        bigint;
begin
  select count(*) into n_null_type from public.listings where property_type_id is null;
  if n_null_type <> 0 then
    raise exception 'property_type_id did not become fully populated: % null row(s)', n_null_type;
  end if;

  select count(*) into n_has_column
    from information_schema.columns
   where table_schema = 'public' and table_name = 'listings' and column_name = 'category';
  if n_has_column <> 0 then
    raise exception 'listings.category still exists';
  end if;

  select count(*) into n_trigger
    from pg_trigger
   where tgrelid = 'public.listings'::regclass and tgname = 'listings_sync_property_type';
  if n_trigger <> 0 then
    raise exception 'listings_sync_property_type trigger still exists';
  end if;

  select count(*) into n_func
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('sync_listing_property_type', 'legacy_category_of');
  if n_func <> 0 then
    raise exception 'sync_listing_property_type / legacy_category_of still exist (% found)', n_func;
  end if;

  -- listing_category the enum is deliberately left in place; see the header (D4).
end $$;

-- ---------------------------------------------------------------------------
-- 5. Post-apply verification. Run these by hand afterwards; each should come back as
--    stated. They are queries, not assertions, so they are safe to re-run at any time.
--
--    a. the column and its dependents are really gone:
--         select column_name from information_schema.columns
--          where table_schema='public' and table_name='listings' and column_name='category';
--       expect  0 rows
--
--    b. every listing still resolves a type and a name through the join:
--         select l.id, l.property_type_id, pt.name
--           from public.listings l join public.property_types pt on pt.id = l.property_type_id
--          where pt.name is null;
--       expect  0 rows
--
--    c. an ordinary save on a live listing still works (property_type_id unchanged, no
--       trigger left that reads a dropped column):
--       from the admin, open any live listing, change nothing but the description, save.
--       expect success.
--
--    d. the public site still answers, category filter included:
--       load the home page, one property page, and a filtered page (?cat=rlot).
--       expect all three to render listings, not a 500.
--
--    e. a match-alert publish still resolves a category correctly:
--       not exercised by this migration directly — covered by the Vitest/Playwright run
--       required before this file was applied (see docs/HANDOFF-2026-08-04.md).
--
-- 6. Rollback. INCOMPLETE BY NATURE — same as apply 2, and the brief calls this apply "the
--    point of no return" for exactly this reason.
--
--    property_type_id -> NOT NULL reverses cleanly (`alter column ... drop not null`).
--    The column itself does not: re-adding `category listing_category` restores nothing on
--    its own. For any listing whose current property_type_id still maps to a
--    legacy_category, the value is recoverable with
--      update listings set category = pt.legacy_category
--        from property_types pt where pt.id = listings.property_type_id;
--    but any listing created after this migration on a type with NO legacy_category has no
--    value to restore — there was never one to begin with. sync_listing_property_type()
--    and legacy_category_of() would also need restoring from
--    20260803090000_listing_encoding_v2_apply1.sql before any of the above would run
--    without erroring.
-- ---------------------------------------------------------------------------
