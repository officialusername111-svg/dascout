-- BD verify finding (run-p3-accounts): the de-attach path shipped in 20260730060000 can
-- never be exercised by a client. Root cause, isolated live: when an UPDATE carries a
-- WHERE clause, Postgres requires SELECT permission for the read, and it then also checks
-- the NEW row against the SELECT policies -- and a just-de-attached (null-owned) row is
-- invisible to its former owner BY DESIGN, so every filtered UPDATE fails with 42501
-- "new row violates row-level security". The same statement with no WHERE (RLS USING
-- scoping the rows on its own) succeeds -- but PostgREST refuses unfiltered updates, so
-- there is no client-reachable shape. Proven both ways in the run record.
--
-- The fix is the pattern the repo already uses for writes RLS cannot express
-- (reorder_listing_photos): one narrow function, definer, self-scoped.
create or replace function public.clear_my_listing_views()
returns integer
language sql
security definer
set search_path = ''
as $$
  with detached as (
    update public.listing_views
       set profile_id = null
     where profile_id = (select auth.uid())
    returning 1
  )
  select count(*)::int from detached;
$$;

-- Repo precedent: definer functions are callable only by the roles that need them.
revoke execute on function public.clear_my_listing_views() from public, anon;
grant execute on function public.clear_my_listing_views() to authenticated;

-- The client-side UPDATE door is now provably dead code: unusable via PostgREST (above)
-- and superseded by the function. A grant that cannot be exercised is still surface --
-- remove it so the function is the single de-attach path. (Both objects were added
-- earlier in this same run and never reached users; this is cleanup, not a narrowing of
-- anything shipped.)
drop policy if exists listing_views_own_detach on public.listing_views;
revoke update (profile_id) on public.listing_views from authenticated;
