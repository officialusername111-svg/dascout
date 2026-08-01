-- Companion to 20260730060000. RLS decides which ROWS an update may touch; it says
-- nothing about which COLUMNS. As applied, the de-attach policy would let a signed-in
-- buyer rewrite viewed_at, viewed_on or even listing_id on their own rows in the same
-- statement that detaches them -- mutating the analytics ledger "Top Properties" counts.
-- Column-level grants are the tool for that: the only updatable column becomes
-- profile_id, and the policy's with_check already forces its only legal new value (null).
--
-- Not a narrowing in practice: no UPDATE policy existed on this table for anon or
-- authenticated before 20260730060000, so no caller could update anything anyway.
revoke update on public.listing_views from anon, authenticated;
grant update (profile_id) on public.listing_views to authenticated;
