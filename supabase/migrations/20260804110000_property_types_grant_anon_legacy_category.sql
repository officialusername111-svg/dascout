-- listing encoding v2 — grant widening ahead of apply 3
--
-- WHY THIS IS ITS OWN FILE, AND WHY IT LANDS FIRST. D7 in docs/BRIEF-listing-encoding-v2.md:
-- "grants that widen may land before the code; anything that narrows must land after it."
-- This migration is pure widening (an anon SELECT grant, nothing revoked, nothing dropped),
-- so it is safe to apply immediately, before either the code that needs it or apply 3's
-- narrowing changes. Bundling it into 20260804120000_listing_encoding_v2_apply3.sql instead
-- would have delayed it until AFTER the code deploy that depends on it — recreating the
-- exact 2026-08-02 outage shape, just inverted (new code live, grant still missing,
-- instead of grant live, old code still selecting a dropped column).
--
-- WHAT IT'S FOR. Apply 3 drops listings.category. The public code that stops depending on
-- it (web/lib/queries.ts) reads the same DbCategory value a different way instead: joined
-- through property_types.legacy_category. Confirmed by direct query before writing this
-- file — anon currently holds SELECT on listings.property_type_id and listings.frontage
-- already (both granted ahead of need back in apply 1, per this same D7 rule), but NOT on
-- property_types.legacy_category, which apply 1's own test file asserts anon is refused
-- ("does not let anon read legacy_category, the transition scaffolding" —
-- property-types-apply1.integration.test.ts). That refusal was correct when written:
-- nothing public read the column yet. It becomes wrong the moment the public join needs it.
--
-- NOT A PRIVACY WIDENING. legacy_category's five possible values are the exact five
-- category labels already public everywhere on the site today (nav, URL keys, card labels)
-- — this grants read access to a value that already appears in HTML, not a new fact.
--
-- THE OLD TEST ASSERTION IS NOW WRONG AND IS UPDATED IN THE SAME COMMIT AS THIS FILE
-- (property-types-apply1.integration.test.ts) — a passing test asserting a refusal this
-- migration deliberately removes would be testing for the bug this file exists to fix.

grant select (legacy_category) on public.property_types to anon;

-- ---------------------------------------------------------------------------
-- Post-migration assertion.
-- ---------------------------------------------------------------------------

do $$
declare
  n bigint;
begin
  select count(*) into n
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'property_types'
     and column_name = 'legacy_category' and grantee = 'anon' and privilege_type = 'SELECT';
  if n <> 1 then
    raise exception 'anon SELECT grant on property_types.legacy_category did not land';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Post-apply verification. Safe to re-run at any time.
--
--   select grantee, privilege_type from information_schema.column_privileges
--    where table_schema='public' and table_name='property_types'
--      and column_name='legacy_category' and grantee='anon';
--   expect  one row: anon, SELECT
--
-- Rollback: `revoke select (legacy_category) on public.property_types from anon;` — but only
-- after confirming no deployed code still reads it through an anon session.
-- ---------------------------------------------------------------------------
