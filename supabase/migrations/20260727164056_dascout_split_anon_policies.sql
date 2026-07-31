-- Anonymous visitors never need is_staff(); giving each role its own policy lets us
-- take EXECUTE away from anon entirely.

drop policy if exists listing_photos_read   on public.listing_photos;
drop policy if exists listing_features_read on public.listing_features;
drop policy if exists price_history_read    on public.price_history;

create policy listing_photos_anon_read on public.listing_photos
  for select to anon
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.status in ('live', 'sold')));
create policy listing_photos_auth_read on public.listing_photos
  for select to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.status in ('live', 'sold'))
         or public.is_staff());

create policy listing_features_anon_read on public.listing_features
  for select to anon
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.status in ('live', 'sold')));
create policy listing_features_auth_read on public.listing_features
  for select to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.status in ('live', 'sold'))
         or public.is_staff());

create policy price_history_anon_read on public.price_history
  for select to anon
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.status in ('live', 'sold')));
create policy price_history_auth_read on public.price_history
  for select to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.status in ('live', 'sold'))
         or public.is_staff());

revoke execute on function public.is_staff() from anon;