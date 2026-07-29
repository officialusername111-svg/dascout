-- Finding 3: anyone could POST unlimited rows into listing_views, which both inflated
-- the "Top Properties" ranking and grew the table without bound on a free-tier database.
-- A view is now one row per listing, per browsing session, per day.

-- The day the view happened, so the uniqueness rule below can be indexed. A generated
-- column cannot be used here: converting timestamptz to a date is STABLE, not IMMUTABLE.
alter table public.listing_views
  add column if not exists viewed_on date not null default ((now() at time zone 'utc')::date);

update public.listing_views
   set session_hash = 'legacy-' || id::text
 where session_hash is null;

alter table public.listing_views
  alter column session_hash set not null;

alter table public.listing_views
  drop constraint if exists listing_views_session_hash_len;
alter table public.listing_views
  add constraint listing_views_session_hash_len
  check (char_length(session_hash) between 16 and 128);

-- The teeth: a repeat view from the same session on the same day is a duplicate-key
-- error rather than another row, so the ranking counts distinct sessions.
create unique index if not exists listing_views_one_per_session_per_day
  on public.listing_views (listing_id, session_hash, viewed_on);

drop policy if exists listing_views_insert_visible on public.listing_views;
create policy listing_views_insert_visible
  on public.listing_views
  for insert
  to anon, authenticated
  with check (
    exists (
      select 1 from public.listings l
       where l.id = listing_views.listing_id
         and l.status in ('live', 'sold')
    )
    and (profile_id is null or profile_id = (select auth.uid()))
    and session_hash is not null
  );
