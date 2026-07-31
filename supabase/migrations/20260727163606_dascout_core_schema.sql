-- DaScout core schema
-- Product rules encoded here: sale only (no rent/lease columns), five categories,
-- prices in pesos, Mindanao locations.

create extension if not exists pg_trgm;

create type public.listing_category as enum (
  'residential_lot', 'farm_land', 'commercial_lot',
  'residential_building', 'commercial_building'
);
create type public.listing_status as enum (
  'draft', 'verifying', 'live', 'sold', 'withdrawn'
);
create type public.user_role as enum ('buyer', 'broker', 'staff', 'admin');
create type public.verification_kind as enum (
  'title_check', 'ground_validation', 'published'
);

-- one row per account; role drives every RLS policy
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        public.user_role not null default 'buyer',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- towns power the A-Z index and the location typeahead without scanning listings
create table public.towns (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  province   text not null,
  slug       text not null unique,
  initial    text generated always as (upper(left(name, 1))) stored,
  created_at timestamptz not null default now(),
  unique (name, province)
);

create table public.listings (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  title          text not null,
  category       public.listing_category not null,
  status         public.listing_status not null default 'draft',
  price_php      numeric(14,2) not null check (price_php > 0),
  town_id        uuid not null references public.towns(id) on delete restrict,
  area_detail    text,
  lot_area_sqm   numeric(12,2) check (lot_area_sqm is null or lot_area_sqm > 0),
  floor_area_sqm numeric(12,2) check (floor_area_sqm is null or floor_area_sqm > 0),
  bedrooms       smallint check (bedrooms is null or bedrooms >= 0),
  bathrooms      smallint check (bathrooms is null or bathrooms >= 0),
  description    text,
  is_trending    boolean not null default false,
  -- nullable and unused in v1; this is what makes the broker phase additive
  broker_id      uuid references public.profiles(id) on delete set null,
  created_by     uuid references public.profiles(id) on delete set null,
  published_at   timestamptz,
  sold_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  search_vector  tsvector generated always as (
                   to_tsvector('english'::regconfig,
                     coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(area_detail, ''))
                 ) stored
);

create index listings_status_idx        on public.listings (status);
create index listings_category_idx      on public.listings (category);
create index listings_town_idx          on public.listings (town_id);
create index listings_price_idx         on public.listings (price_php);
create index listings_created_idx       on public.listings (created_at desc);
create index listings_search_idx        on public.listings using gin (search_vector);
create index listings_title_trgm_idx    on public.listings using gin (title gin_trgm_ops);

create table public.listing_photos (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(id) on delete cascade,
  storage_path text not null,
  alt_text     text,
  sort_order   smallint not null default 0,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now()
);
create index listing_photos_listing_idx on public.listing_photos (listing_id, sort_order);
create unique index listing_photos_one_primary_idx
  on public.listing_photos (listing_id) where is_primary;

create table public.features (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique
);

create table public.listing_features (
  listing_id uuid not null references public.listings(id) on delete cascade,
  feature_id uuid not null references public.features(id) on delete cascade,
  primary key (listing_id, feature_id)
);
create index listing_features_feature_idx on public.listing_features (feature_id);

-- required: the "Price reduced" panel cannot be derived without a history
create table public.price_history (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  old_price  numeric(14,2),
  new_price  numeric(14,2) not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index price_history_listing_idx on public.price_history (listing_id, changed_at desc);

-- required: powers Top Properties for day / week / month
create table public.listing_views (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(id) on delete cascade,
  profile_id   uuid references public.profiles(id) on delete set null,
  session_hash text,
  viewed_at    timestamptz not null default now()
);
create index listing_views_listing_time_idx on public.listing_views (listing_id, viewed_at desc);
create index listing_views_time_idx         on public.listing_views (viewed_at desc);

create table public.favorites (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, listing_id)
);
create index favorites_listing_idx on public.favorites (listing_id);

create table public.property_requests (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid references public.profiles(id) on delete set null,
  email          text not null,
  category       public.listing_category,
  preferred_town text,
  budget_min     numeric(14,2) check (budget_min is null or budget_min >= 0),
  budget_max     numeric(14,2) check (budget_max is null or budget_max >= 0),
  notes          text,
  is_handled     boolean not null default false,
  created_at     timestamptz not null default now(),
  check (budget_min is null or budget_max is null or budget_max >= budget_min)
);
create index property_requests_created_idx on public.property_requests (created_at desc);

-- the audit trail behind "we verify them" — the promise the brand rests on
create table public.verification_events (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(id) on delete cascade,
  kind         public.verification_kind not null,
  performed_by uuid references public.profiles(id) on delete set null,
  notes        text,
  occurred_at  timestamptz not null default now()
);
create index verification_events_listing_idx on public.verification_events (listing_id, occurred_at desc);