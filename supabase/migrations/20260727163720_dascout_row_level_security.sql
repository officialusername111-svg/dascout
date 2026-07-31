-- Access control lives here, not in the UI. A page that forgets to check still cannot leak.

alter table public.profiles            enable row level security;
alter table public.towns               enable row level security;
alter table public.listings            enable row level security;
alter table public.listing_photos      enable row level security;
alter table public.features            enable row level security;
alter table public.listing_features    enable row level security;
alter table public.price_history       enable row level security;
alter table public.listing_views       enable row level security;
alter table public.favorites           enable row level security;
alter table public.property_requests   enable row level security;
alter table public.verification_events enable row level security;

-- roles can only be changed by staff, never by the account holder
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and not public.is_staff() then
    raise exception 'only staff may change a profile role';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- profiles
create policy profiles_select_own_or_staff on public.profiles
  for select to authenticated using ((select auth.uid()) = id or public.is_staff());
create policy profiles_update_own on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy profiles_staff_all on public.profiles
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- reference data is public: the filters and A-Z index need it before sign-in
create policy towns_public_read on public.towns
  for select to anon, authenticated using (true);
create policy towns_staff_write on public.towns
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy features_public_read on public.features
  for select to anon, authenticated using (true);
create policy features_staff_write on public.features
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- listings: the public sees live rows only; drafts stay invisible until verified
create policy listings_public_read_live on public.listings
  for select to anon, authenticated
  using (status in ('live', 'sold'));
create policy listings_staff_read_all on public.listings
  for select to authenticated using (public.is_staff());
create policy listings_broker_read_own on public.listings
  for select to authenticated using (broker_id = (select auth.uid()));
create policy listings_staff_write on public.listings
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- child rows follow the visibility of their parent listing
create policy listing_photos_read on public.listing_photos
  for select to anon, authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and (l.status in ('live','sold') or public.is_staff())));
create policy listing_photos_staff_write on public.listing_photos
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy listing_features_read on public.listing_features
  for select to anon, authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and (l.status in ('live','sold') or public.is_staff())));
create policy listing_features_staff_write on public.listing_features
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- price history is public for visible listings; it is what the "Price reduced" feed reads
create policy price_history_read on public.price_history
  for select to anon, authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and (l.status in ('live','sold') or public.is_staff())));
create policy price_history_staff_write on public.price_history
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- anyone may record a view; only staff may read the raw rows (they identify people).
-- public view counts come from the top_listings() function instead.
create policy listing_views_insert_any on public.listing_views
  for insert to anon, authenticated with check (true);
create policy listing_views_staff_read on public.listing_views
  for select to authenticated using (public.is_staff());

-- favourites are strictly the account holder's own
create policy favorites_own on public.favorites
  for all to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

-- the public request form must work signed out
create policy property_requests_insert_any on public.property_requests
  for insert to anon, authenticated with check (true);
create policy property_requests_read_own_or_staff on public.property_requests
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_staff());
create policy property_requests_staff_write on public.property_requests
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- the verification trail is internal
create policy verification_events_staff_all on public.verification_events
  for all to authenticated using (public.is_staff()) with check (public.is_staff());