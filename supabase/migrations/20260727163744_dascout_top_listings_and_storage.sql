-- Public view counts without exposing who viewed what.
create or replace function public.top_listings(period text default 'day', row_limit int default 6)
returns table (listing_id uuid, views bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select v.listing_id, count(*)::bigint as views
  from public.listing_views v
  join public.listings l on l.id = v.listing_id
  where l.status in ('live', 'sold')
    and v.viewed_at >= now() - case period
          when 'week'  then interval '7 days'
          when 'month' then interval '30 days'
          else interval '1 day'
        end
  group by v.listing_id
  order by views desc
  limit greatest(1, least(row_limit, 50));
$$;

revoke execute on function public.top_listings(text, int) from public;
grant execute on function public.top_listings(text, int) to anon, authenticated;

-- photo storage: public to read, staff to write
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do nothing;

create policy listing_photos_object_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'listing-photos');

create policy listing_photos_object_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'listing-photos' and public.is_staff());

create policy listing_photos_object_update on storage.objects
  for update to authenticated
  using (bucket_id = 'listing-photos' and public.is_staff())
  with check (bucket_id = 'listing-photos' and public.is_staff());

create policy listing_photos_object_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'listing-photos' and public.is_staff());