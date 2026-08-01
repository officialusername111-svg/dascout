-- Phase 3 (run-p3-accounts): browsing history on the account.
--
-- `listing_views` was built in Phase 0/2 as the analytics ledger behind "Top Properties":
-- anyone may INSERT a view of a live/sold listing, and only staff may read. That is the
-- right shape for counting views and the wrong shape for showing a buyer what they have
-- been looking at -- a buyer cannot read even their own rows today, so "browsing history
-- on the account" would render empty forever with nothing to reveal why.
--
-- Two additive grants fix that, and deliberately no more. Nothing is narrowed here.

-- 1. A buyer may read their OWN view rows. Staff keep their existing separate policy, so
--    this widens nothing for them; an anonymous visitor has no profile_id and matches
--    nothing. `(select auth.uid())` is wrapped per the repo's existing policy style so the
--    planner evaluates it once per statement rather than once per row.
drop policy if exists listing_views_own_read on public.listing_views;
create policy listing_views_own_read
  on public.listing_views
  for select
  to authenticated
  using (profile_id = (select auth.uid()));

-- 2. "Clear browsing history" DE-ATTRIBUTES rather than deletes.
--
--    A DELETE grant was the obvious move and is the wrong one: these rows are what the
--    "Top Properties" ranking counts, so letting a buyer delete them would let anyone
--    quietly rewrite the site's most-viewed list by favouriting, viewing and clearing in a
--    loop. Setting `profile_id` to null instead erases the personal association while the
--    view itself still counts -- the honest answer for the ranking and the better answer
--    for personal data, which should not be retained in an identifiable form once the
--    person has asked for it to go.
--
--    The `with_check` is what makes this safe: the caller may only ever leave the row with
--    a null `profile_id`. Re-attributing a row to somebody else, or claiming a stranger's
--    anonymous view as one's own, both fail -- the `using` clause requires the row to
--    already be yours, and the `with_check` requires it to end up owned by nobody.
drop policy if exists listing_views_own_detach on public.listing_views;
create policy listing_views_own_detach
  on public.listing_views
  for update
  to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id is null);

-- Reading a buyer's own history needs to find their rows by owner, newest first. Without
-- this the read is a sequential scan filtered by profile_id; the existing indexes are both
-- keyed on listing_id, which answers a different question. Partial, because the
-- overwhelming majority of rows are anonymous and never match this predicate.
create index if not exists listing_views_profile_time_idx
  on public.listing_views (profile_id, viewed_at desc)
  where profile_id is not null;
