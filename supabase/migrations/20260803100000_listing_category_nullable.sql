-- listing encoding v2 — apply 1b: let the owner add a sixth property type today
--
-- WHY THIS EXISTS. Apply 1 left `listings.category` NOT NULL, which meant a property type
-- created through the piece-2 CRUD screen had no enum value to pair with and so could not
-- be assigned to any listing until apply 3 — the point-of-no-return release. The owner
-- asked (2026-08-03) to remove that wait. This does it by relaxing the column rather than
-- by bringing apply 3 forward, because apply 3 DROPS `category` and every public query
-- still selects it; dropping it before the code reads `property_type_id` would take the
-- public site down permanently rather than for the ten minutes 2026-08-02 cost.
--
-- WHAT MAKES RELAXING SAFE, and it is not safe on its own. A null `category` on a listing
-- the public can see would render a blank type on the property page and the card, because
-- web/lib/queries.ts still maps `category` through keyFromDb(). The two CHECK constraints
-- below are what close that: a listing may reach `live` or `sold` ONLY with a category.
-- A sixth type is therefore fully usable in draft today, and the constraint lifts by
-- itself in apply 3 when `category` goes away and the code reads `property_type_id`.
--
-- Both constraints pass on all 12 current rows — every one has a category. Nothing here
-- changes a grant, so it is safe against the deployment running right now.
--
-- CHECKED BEFORE WRITING THIS: `search_vector` is generated from title, description and
-- area_detail only — it does not reference `category`, so a null cannot null out the
-- whole tsvector and silently drop a listing out of search. No trigger reads `category`
-- either, apart from the one redefined below.

-- ---------------------------------------------------------------------------
-- 1. Relax the column, then immediately constrain what the relaxation allows.
-- ---------------------------------------------------------------------------

alter table public.listings alter column category drop not null;

-- At least one of the two type columns must always be present. Without this, the trigger
-- below can leave a row carrying neither when a caller supplies neither.
alter table public.listings drop constraint if exists listings_type_identified;
alter table public.listings add constraint listings_type_identified
  check (category is not null or property_type_id is not null);

-- The public-render guard. `live` and `sold` are the two statuses
-- listings_public_read_live exposes to anon, and both keep their names through apply 2,
-- so this constraint survives the status rename untouched. Drop it in apply 3, together
-- with the column it protects.
alter table public.listings drop constraint if exists listings_category_required_when_public;
alter table public.listings add constraint listings_category_required_when_public
  check (category is not null or status not in ('live', 'sold'));

-- ---------------------------------------------------------------------------
-- 2. legacy_category_of becomes a plain lookup.
--
--    In apply 1 it raised when a property type had no legacy category, because at that
--    point a null could only end as a bare NOT NULL violation and an explanation was
--    better than that. A null is now a legitimate state — it is exactly what a
--    sixth property type produces — so the exception has to go or every insert against a
--    new type fails. The constraints above are what handle the null now.
-- ---------------------------------------------------------------------------

create or replace function public.legacy_category_of(p_type_id uuid)
returns public.listing_category
language sql
stable
security definer
set search_path = ''
as $$
  select pt.legacy_category from public.property_types pt where pt.id = p_type_id;
$$;

revoke all on function public.legacy_category_of(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The sync trigger keeps its logic and loses only the raise.
--
--    Unchanged in shape from apply 1: whichever column the caller moved is authoritative,
--    and an UPDATE that changes property_type_id re-derives category rather than leaving
--    it stale. The only difference is that a type with no legacy mapping now sets category
--    to null instead of raising.
-- ---------------------------------------------------------------------------

create or replace function public.sync_listing_property_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type_id uuid;
begin
  if new.property_type_id is null then
    select pt.id into v_type_id
      from public.property_types pt
     where pt.legacy_category = new.category;
    new.property_type_id := v_type_id;

  elsif tg_op = 'INSERT' and new.category is null then
    new.category := public.legacy_category_of(new.property_type_id);

  elsif tg_op = 'UPDATE' and new.property_type_id is distinct from old.property_type_id then
    new.category := public.legacy_category_of(new.property_type_id);

  elsif tg_op = 'UPDATE' and new.category is distinct from old.category then
    select pt.id into v_type_id
      from public.property_types pt
     where pt.legacy_category = new.category;
    new.property_type_id := v_type_id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_listing_property_type() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Post-apply verification.
--
--    a. the column is nullable and both constraints are in force:
--         select is_nullable from information_schema.columns
--          where table_schema='public' and table_name='listings' and column_name='category';
--         -- expect YES
--         select conname from pg_constraint where conrelid='public.listings'::regclass
--           and conname in ('listings_type_identified','listings_category_required_when_public');
--         -- expect both rows
--
--    b. no live listing lost its category:
--         select count(*) from public.listings where category is null;  -- expect 0
--
--    c. the public site still answers — home, a category filter, a property page, sitemap.
--
-- 5. Rollback. Safe only while no listing has a null category (check b above returns 0);
--    if one does, that listing must be given a category first or the NOT NULL will refuse.
--
--    begin;
--      alter table public.listings drop constraint if exists listings_category_required_when_public;
--      alter table public.listings drop constraint if exists listings_type_identified;
--      alter table public.listings alter column category set not null;
--      -- and restore the raising form of legacy_category_of from
--      -- 20260803090000_listing_encoding_v2_apply1.sql section 4.
--    commit;
-- ---------------------------------------------------------------------------
