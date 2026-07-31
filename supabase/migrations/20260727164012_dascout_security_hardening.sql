-- 1. keep extensions out of the public API schema
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;

-- 2. trigger functions must not be callable as RPC endpoints.
-- (Trigger execution is not privilege-checked against the invoking user, so this is safe.)
revoke execute on function public.handle_new_user()        from public, anon, authenticated;
revoke execute on function public.record_price_change()    from public, anon, authenticated;
revoke execute on function public.guard_profile_role()     from public, anon, authenticated;
revoke execute on function public.touch_updated_at()       from public, anon, authenticated;
revoke execute on function public.sync_listing_timestamps() from public, anon, authenticated;

-- 3. a public bucket serves object URLs without a broad SELECT policy;
--    the policy only added the ability to enumerate every file.
drop policy if exists listing_photos_object_read on storage.objects;

-- 4. replace the two unrestricted INSERT policies with real constraints
drop policy if exists listing_views_insert_any on public.listing_views;
create policy listing_views_insert_visible on public.listing_views
  for insert to anon, authenticated
  with check (
    exists (select 1 from public.listings l
            where l.id = listing_id and l.status in ('live', 'sold'))
    and (profile_id is null or profile_id = (select auth.uid()))
  );

drop policy if exists property_requests_insert_any on public.property_requests;
create policy property_requests_insert_valid on public.property_requests
  for insert to anon, authenticated
  with check (
    (profile_id is null or profile_id = (select auth.uid()))
    and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  );