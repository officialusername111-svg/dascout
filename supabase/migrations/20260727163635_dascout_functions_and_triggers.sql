-- Helper used by every RLS policy. SECURITY DEFINER so the policy can read
-- profiles without the caller needing read access to it (avoids recursion).
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('staff', 'admin')
  );
$$;

-- every new account gets a profile, defaulting to the buyer role
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- price changes are recorded automatically, so the "Price reduced" feed is real
create or replace function public.record_price_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.price_php is distinct from old.price_php then
    insert into public.price_history (listing_id, old_price, new_price, changed_by)
    values (new.id, old.price_php, new.price_php, (select auth.uid()));
  end if;
  return new;
end;
$$;

create trigger listings_record_price_change
  after update of price_php on public.listings
  for each row execute function public.record_price_change();

-- lifecycle timestamps are set by the database, not by whoever wrote the form
create or replace function public.sync_listing_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status = 'live' and old.status is distinct from new.status and new.published_at is null then
    new.published_at := now();
  end if;
  if new.status = 'sold' and old.status is distinct from new.status then
    new.sold_at := coalesce(new.sold_at, now());
  end if;
  return new;
end;
$$;

create trigger listings_sync_timestamps
  before update on public.listings
  for each row execute function public.sync_listing_timestamps();