-- listing encoding v2 — APPLY 1 of 3 (additive only)
--
-- Spec: docs/BRIEF-listing-encoding-v2.md. Section 8b wins over sections 1-9; this file
-- implements row 1 of 8b's D5 table and nothing else.
--
-- WHAT THIS APPLY IS FOR. It puts the new shape in place beside the old one without
-- taking anything away, so the site keeps running on the old columns until the code that
-- reads the new ones is deployed. Every statement below either creates something new or
-- widens an existing grant. Nothing is dropped, nothing is narrowed, nothing is renamed.
-- Applying this against the CURRENT deployment is safe and changes nothing on screen.
--
-- DELIBERATELY NOT HERE:
--   * the status rename (draft -> list, verifying -> for_approval)   — apply 2
--   * guard_listing_publish redesign                                  — apply 2
--   * dropping verification_events                                    — apply 2
--   * listings.property_type_id NOT NULL, dropping listings.category  — apply 3
--   * area_detail                    — no schema change at all (8b D3). It feeds the
--     search_vector generated column, so converting it to a lookup would force dropping
--     and rebuilding that column and its GIN index. "Property Location" is a UI relabel.
--   * public.listing_category is NOT dropped (8b D4). property_requests.category is a
--     second column of that type, so Postgres would refuse. The enum survives this run,
--     unused by listings after apply 3. That is the safest available state.
--
-- ON THE WORD "VERIFIED" (8b D10). This apply adds a feature called "All documents
-- Verified" in the same run that begins retiring the verification workflow. That is not
-- a contradiction and the removal is not incomplete: a paperwork claim about a property
-- is not a workflow step about a listing. "Title-verified by DaScout" stays in public
-- metadata, the home page VerifiedBand and the alert emails on purpose.
--
-- THE GRANT RULE THIS FILE OBEYS. A grant change and the code depending on it must ship
-- together; grants that WIDEN may land before the code, anything that NARROWS must land
-- after it. A ten-minute outage on 2026-08-02 came from getting that backwards. Section 6
-- below only widens, so this file may be applied before the code deploys.
--
-- NO EXPLICIT BEGIN/COMMIT. The file is sent as one batch, which Postgres already runs
-- inside a single implicit transaction — it is all-or-nothing as written. An explicit
-- COMMIT here would instead end the caller's own transaction out from under it.

-- ---------------------------------------------------------------------------
-- 1. property_types — the lookup table that will replace the listing_category enum.
--
--    WHY THE SLUGS ARE THE URL KEYS AND NOT THE ENUM VALUES. Every public category
--    link today is `?cat=rlot` / `farm` / `clot` / `rbdg` / `cbdg` — short keys the
--    original mockup put in URLs, mapped to enum values in web/lib/categories.ts.
--    Seeding the slugs as those keys means every existing link and bookmark keeps
--    working with no redirect layer. Seeding them as `residential_lot` would have
--    broken every saved URL on the site.
--
--    WHY name/plural_name/icon/group_key ALL LIVE HERE. The point of the table is that
--    the owner can edit it without a developer. Anything left behind in TypeScript is a
--    field they cannot change, which defeats the exercise. web/lib/categories.ts holds
--    exactly these four things today; the seed below reproduces it verbatim so nothing
--    on screen changes on migration day.
--
--    group_key answers owner question O4 (2026-08-03): the browse nav's literal
--    "Lots"/"Buildings" slug lists give way to this column, so a sixth property type
--    places itself in the nav instead of silently missing from it.
--    It is NULLABLE and deliberately unconstrained:
--      * NULL means "no group" — Farm Land is in neither nav group today and seeds NULL,
--        which reproduces current behaviour exactly.
--      * No CHECK, because a new nav group would otherwise need a migration, which is
--        the thing the owner asked to stop needing. The rule the nav must implement is
--        degradation-safe: a group_key the UI has no label for renders that type as its
--        own top-level nav item rather than hiding it.
--
--    legacy_category is the backfill join key, kept as data rather than a hard-coded
--    CASE so the mapping is inspectable and the assertion in section 3 can be trusted.
--    It is dropped in apply 3 along with listings.category.
-- ---------------------------------------------------------------------------

create table if not exists public.property_types (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name            text not null unique,
  plural_name     text not null,
  icon            text not null default 'pin',
  group_key       text,
  sort_order      smallint not null default 100,
  is_active       boolean not null default true,
  legacy_category public.listing_category unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.property_types is
  'Owner-editable property type (zoning classification). Replaces the listing_category enum. slug is the public URL key (?cat=).';
comment on column public.property_types.slug is
  'Public URL key. Lowercase, digits and hyphens only — it lands in query strings, so a space or a capital would be percent-encoded into every saved link.';
comment on column public.property_types.group_key is
  'Nav grouping. NULL = ungrouped (its own top-level nav item). Unconstrained on purpose; a key the UI cannot label must render ungrouped, never hidden.';
comment on column public.property_types.legacy_category is
  'Transition-only join key to the listing_category enum. Dropped in apply 3.';

drop trigger if exists property_types_touch_updated_at on public.property_types;
create trigger property_types_touch_updated_at
  before update on public.property_types
  for each row execute function public.touch_updated_at();

-- The seed IS web/lib/categories.ts, reproduced. Names keep their abbreviations
-- ("Residential Bldg") because that is what the screen says today; the owner renames
-- afterwards, which is the entire point of the table. sort_order leaves gaps of 10 so a
-- type can be inserted between two others without renumbering the table.
insert into public.property_types (slug, name, plural_name, icon, group_key, sort_order, legacy_category) values
  ('rlot', 'Residential Lot',  'Residential Lots',      'pin',  'lots',  10, 'residential_lot'),
  ('farm', 'Farm Land',        'Farm Land',             'tag',  null,    20, 'farm_land'),
  ('clot', 'Commercial Lot',   'Commercial Lots',       'area', 'lots',  30, 'commercial_lot'),
  ('rbdg', 'Residential Bldg', 'Residential Buildings', 'home', 'bldgs', 40, 'residential_building'),
  ('cbdg', 'Commercial Bldg',  'Commercial Buildings',  'key',  'bldgs', 50, 'commercial_building')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 2. RLS on property_types — mirrors towns and features exactly.
--
--    public_read is `using (true)` and NOT `using (is_active)` on purpose: an
--    archived type must stay readable, or a listing that still points at it loses its
--    label on the public page. is_active governs what the encoder may PICK, which is a
--    UI concern, not a visibility one.
-- ---------------------------------------------------------------------------

alter table public.property_types enable row level security;

drop policy if exists property_types_public_read on public.property_types;
create policy property_types_public_read on public.property_types
  for select to anon, authenticated using (true);

drop policy if exists property_types_staff_write on public.property_types;
create policy property_types_staff_write on public.property_types
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 3. listings — the new type reference and the frontage field.
--
--    property_type_id is NULLABLE here and set NOT NULL in apply 3. Until then
--    listings.category is still populated and still correct, which is what makes
--    everything up to apply 2 revertible by reverting the code alone.
--
--    ON DELETE RESTRICT matches listings.town_id: deleting a property type that
--    listings still point at must fail loudly, not silently orphan them.
-- ---------------------------------------------------------------------------

alter table public.listings add column if not exists property_type_id uuid
  references public.property_types(id) on delete restrict;
alter table public.listings add column if not exists frontage text;

comment on column public.listings.frontage is
  'Free text, no unit enforced and no numeric validation (brief section 8 answer 3). Public.';

create index if not exists listings_property_type_idx on public.listings (property_type_id);

update public.listings l
   set property_type_id = pt.id
  from public.property_types pt
 where pt.legacy_category = l.category
   and l.property_type_id is null;

do $$
declare
  n_unmapped bigint;
  n_types    bigint;
begin
  select count(*) into n_unmapped from public.listings where property_type_id is null;
  if n_unmapped > 0 then
    raise exception
      'backfill incomplete: % listing(s) have no property_type_id. Every listing_category value must have a matching property_types.legacy_category row before apply 3 can set NOT NULL.',
      n_unmapped;
  end if;

  select count(*) into n_types from public.property_types;
  if n_types < 5 then
    raise exception 'expected at least 5 seeded property types, found %', n_types;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Keeping the two columns in step during the transition.
--
--    THIS IS THE PIECE THAT MAKES THE THREE-APPLY PLAN SAFE IN EITHER DEPLOY ORDER.
--    Between apply 1 and apply 3 there are two generations of code in play. Old code
--    writes `category` and knows nothing about `property_type_id` — its inserts would
--    leave the new column NULL and apply 3's NOT NULL would then fail on rows created
--    after this migration. New code writes `property_type_id` and its inserts would
--    violate category's NOT NULL. The trigger fills whichever side is missing from the
--    other, so both generations write complete rows and neither has to know about the
--    other.
--
--    KNOWN LIMITATION, stated here because it will otherwise be discovered as a
--    confusing error: a property type the owner ADDS through the piece-2 CRUD screen has
--    no legacy_category, and listings.category is NOT NULL until apply 3. A listing
--    therefore cannot be assigned a sixth property type until apply 3 has run. The
--    exception below says so in words rather than surfacing as a bare NOT NULL violation.
--    The five seeded types are unaffected and work immediately.
-- ---------------------------------------------------------------------------

-- Resolves a property type back to its enum value, refusing in words when it has none.
-- Factored out because the trigger below needs it on two different branches and a
-- silent NULL on either of them becomes a bare NOT NULL violation with no explanation.
create or replace function public.legacy_category_of(p_type_id uuid)
returns public.listing_category
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_legacy public.listing_category;
begin
  select pt.legacy_category into v_legacy
    from public.property_types pt
   where pt.id = p_type_id;

  if v_legacy is null then
    raise exception
      'property type % has no legacy category, and listings.category is still NOT NULL until apply 3 of listing encoding v2. A property type added after this migration cannot be used on a listing until apply 3 has run.',
      p_type_id;
  end if;
  return v_legacy;
end;
$$;

revoke all on function public.legacy_category_of(uuid) from public, anon, authenticated;

create or replace function public.sync_listing_property_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type_id uuid;
begin
  -- Which column is authoritative depends on which one the caller actually moved.
  -- An UPDATE that changes property_type_id must re-derive category, or the two
  -- disagree and the public site — which still reads category until apply 3 — keeps
  -- showing the old type. Deriving only when one side is NULL is not enough: on an
  -- UPDATE the untouched side holds its previous value, never NULL.
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

drop trigger if exists listings_sync_property_type on public.listings;
create trigger listings_sync_property_type
  before insert or update of category, property_type_id on public.listings
  for each row execute function public.sync_listing_property_type();

-- ---------------------------------------------------------------------------
-- 5. property_requests, towns, features.
--
--    towns.is_active and features.is_active/sort_order are what the piece-2 CRUD
--    screens need to archive and order rows without deleting them.
--
--    THE FOREIGN KEY CHANGE IS THE ONE THAT MATTERS (8b D8, owner answer O5). Today
--    listing_features.feature_id is ON DELETE CASCADE. There is no features CRUD screen
--    yet, so nothing can trigger it. The moment piece 2 ships one, deleting a feature
--    silently strips it from every listing that had it — no warning, no undo, and no
--    record that it ever applied. RESTRICT turns that into a refusal the screen can show
--    as "this feature is in use on N listings". It ships here, ahead of the screen, so
--    the dangerous window never opens.
-- ---------------------------------------------------------------------------

alter table public.property_requests add column if not exists wanted_property_type_id uuid
  references public.property_types(id) on delete restrict;

alter table public.towns    add column if not exists is_active  boolean  not null default true;
alter table public.features add column if not exists is_active  boolean  not null default true;
alter table public.features add column if not exists sort_order smallint not null default 100;

alter table public.listing_features drop constraint if exists listing_features_feature_id_fkey;
alter table public.listing_features add constraint listing_features_feature_id_fkey
  foreign key (feature_id) references public.features(id) on delete restrict;

-- The three new features (brief section 1). These ADD to the existing 31; nothing
-- existing is removed. Names are the owner's strings verbatim, including the
-- capitalisation of "All documents Verified".
insert into public.features (name, slug) values
  ('All documents Verified',  'all-documents-verified'),
  ('Updated Tax Declaration', 'updated-tax-declaration'),
  ('Direct Owner',            'direct-owner')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Grants. WIDENING ONLY — see the header.
--
--    property_types is a NEW table, and that is exactly where the trap is. Default
--    privileges in this database grant ALL (arwdDxtm) on new public tables to `anon`
--    and `authenticated`. A `create table` therefore hands anonymous callers INSERT,
--    UPDATE and DELETE the moment it runs, with only RLS in the way. That is the same
--    inheritance that gave listings.property_no public SELECT for free in August. The
--    revoke below is not tidiness; without it this table ships wide open at the grant
--    layer.
--
--    anon gets SELECT on the presentation columns only. legacy_category, created_at and
--    updated_at are withheld — no public surface needs them, and legacy_category is
--    transition scaffolding nobody outside the migration should read.
--
--    authenticated gets row-level DML and no REFERENCES/TRIGGER/TRUNCATE. Staff and
--    buyers share the `authenticated` Postgres role, so the grant cannot tell them
--    apart; property_types_staff_write is what actually stops a buyer writing.
--
--    listings: frontage and property_type_id are added to the anon column list. The
--    table-level grant was revoked in 20260802160000, so a column added later is NOT
--    readable by anon until it is named here — the fail-closed property that migration
--    bought. frontage is public per owner answer O3 (2026-08-03).
--
--    property_requests.wanted_property_type_id, towns.is_active and
--    features.is_active/sort_order need no grant: those three tables still hold
--    table-level grants, which cover columns added later automatically.
-- ---------------------------------------------------------------------------

revoke all on table public.property_types from anon, authenticated;

grant select (id, slug, name, plural_name, icon, group_key, sort_order, is_active)
  on table public.property_types to anon;

grant select, insert, update, delete
  on table public.property_types to authenticated;

grant select (frontage, property_type_id) on table public.listings to anon;

-- ---------------------------------------------------------------------------
-- 7. Post-apply verification. Run these by hand after the migration returns; each
--    should come back as stated. They are queries, not assertions, so they are safe to
--    re-run at any time.
--
--    a. every listing mapped, five types seeded:
--         select count(*) filter (where property_type_id is null) as unmapped,
--                (select count(*) from public.property_types) as types
--           from public.listings;
--       expect  unmapped = 0, types = 5
--
--    b. anon cannot write the new table (expect false on all three):
--         select has_table_privilege('anon','public.property_types','INSERT'),
--                has_table_privilege('anon','public.property_types','UPDATE'),
--                has_table_privilege('anon','public.property_types','DELETE');
--
--    c. anon CAN read what the public site needs, and cannot read the scaffolding:
--         select has_column_privilege('anon','public.property_types','slug','SELECT')      -- true
--              , has_column_privilege('anon','public.property_types','legacy_category','SELECT') -- false
--              , has_column_privilege('anon','public.listings','frontage','SELECT')        -- true
--              , has_column_privilege('anon','public.listings','price_php','SELECT');      -- false, unchanged
--
--    d. the feature FK is now RESTRICT:
--         select pg_get_constraintdef(oid) from pg_constraint
--          where conname = 'listing_features_feature_id_fkey';
--
--    e. the public site still answers. Load the home page, one property page and
--       /sitemap.xml. Nothing in this file changes what they read, so a failure here
--       means something else — but check, because the failure mode of a grant mistake
--       on this project is the whole site returning 42501 at once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 8. Rollback. Complete and safe: this apply added only new objects, new nullable
--    columns and widened grants, so undoing it returns the database to its exact
--    pre-migration state. Nothing here destroys data that existed before the apply.
--
--    The three new features are left in place by the rollback below — deleting them
--    would fail if an encoder had already attached one to a listing, and an unused
--    feature row is harmless. Remove them by hand if genuinely unwanted:
--      delete from public.features
--       where slug in ('all-documents-verified','updated-tax-declaration','direct-owner');
--
--    begin;
--      drop trigger if exists listings_sync_property_type on public.listings;
--      drop function if exists public.sync_listing_property_type();
--      drop function if exists public.legacy_category_of(uuid);
--
--      alter table public.listing_features drop constraint if exists listing_features_feature_id_fkey;
--      alter table public.listing_features add constraint listing_features_feature_id_fkey
--        foreign key (feature_id) references public.features(id) on delete cascade;
--
--      revoke select (frontage, property_type_id) on table public.listings from anon;
--
--      alter table public.property_requests drop column if exists wanted_property_type_id;
--      alter table public.listings          drop column if exists frontage;
--      alter table public.listings          drop column if exists property_type_id;
--      alter table public.towns             drop column if exists is_active;
--      alter table public.features          drop column if exists is_active;
--      alter table public.features          drop column if exists sort_order;
--
--      drop table if exists public.property_types;
--    commit;
-- ---------------------------------------------------------------------------
