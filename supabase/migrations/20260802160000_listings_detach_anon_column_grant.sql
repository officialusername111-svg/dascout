-- run-p8-price-detach — take `price_php` out of anon's reach, and take anon's write
-- grants on listings away entirely.
--
-- THE HOLE THIS CLOSES. The standing project rule is "no peso amounts anywhere public".
-- Until now it was enforced only by the application never selecting the column: `anon`
-- held table-level SELECT on public.listings, so all 22 columns were readable directly
-- over PostgREST by anyone holding the publishable key — and that key ships in the public
-- site's JavaScript bundle by design. One request returned real prices for live listings.
-- The two E2E specs that assert "no peso on the public page" passed throughout and always
-- would have: they read rendered HTML, not the API surface. The rule looked enforced and
-- was not. This predates the property-number work by months and was not introduced by it.
--
-- It also closes the same hole on `property_no`, `broker_id`, `created_by` and `sold_at`,
-- none of which any public page shows, and none of which were ever meant to be readable.
--
-- WHY A COLUMN-GRANT DETACH AND NOT RLS. RLS decides which ROWS a caller may see. It has
-- nothing to say about which COLUMNS, so no policy can hide a price on a row the visitor
-- is otherwise allowed to read. Column privileges are the only mechanism Postgres offers
-- here. Same pattern as 20260730095404 on listing_views.
--
-- THE ORDERING CHANGE THAT HAD TO COME FIRST. Ordering by a column requires SELECT on it.
-- getSpotlightListings (web/lib/queries.ts) — the rotating home-page hero — ordered by
-- `price_php desc`. It never displayed the price; it ranked by it. Revoking underneath
-- that would have taken the hero down on the home page. The query now orders by
-- `published_at desc, created_at desc` and this migration is safe to apply. THE CODE
-- CHANGE SHIPS IN THE SAME COMMIT AS THIS FILE — applying this migration against an older
-- deployment breaks the home page.
--
-- WHAT THIS DOES NOT CLOSE, stated plainly so nobody reads more safety into it than it has:
-- `authenticated` keeps full column SELECT, and `listings_public_read_live` grants SELECT
-- on every live and sold row to `{anon, authenticated}`. Registration is self-service, so
-- ANY PERSON WHO SIGNS UP AND CONFIRMS AN EMAIL CAN STILL READ price_php OVER THE API.
-- Staff and buyers share one Postgres role, so a column grant cannot tell them apart, and
-- narrowing `authenticated` would take the price away from the admin panel, which needs
-- it. Genuinely closing that needs the price moved to its own staff-only table. What this
-- migration buys is real but bounded: the bar moves from "anyone who reads our JavaScript"
-- to "anyone who registers an account", which is the difference between a scrape and a
-- deliberate act. The owner has been told; the follow-up is theirs to call.

-- ---------------------------------------------------------------------------
-- 1. Drop everything anon holds on the table, then hand back only reads, only
--    on the columns the public site genuinely uses.
--
--    `revoke all` rather than `revoke select`: anon also held INSERT, UPDATE, DELETE,
--    REFERENCES, TRIGGER and TRUNCATE on this table. Only RLS stood between an anonymous
--    caller and a write. Nothing anonymous has any business writing a listing, so the
--    grant goes and RLS stops being the only layer. (The owner asked for INSERT/UPDATE/
--    REFERENCES; DELETE, TRIGGER and TRUNCATE are the same class of privilege and leaving
--    them behind while removing the others would have been incoherent.)
-- ---------------------------------------------------------------------------

revoke all on table public.listings from anon;

-- ---------------------------------------------------------------------------
-- 2. The column list, and how it was derived.
--
--    Every one of these is read by an anon-role query — not merely displayed. Filters,
--    sort keys and embed join keys need SELECT just as much as rendered fields do, and
--    that is exactly where a hand-written list goes wrong. Derivation, one column at a
--    time, from web/lib/queries.ts and web/app/sitemap.ts:
--
--      CARD_COLUMNS, rendered on every card:
--        id, slug, title, category, area_detail, lot_area_sqm, floor_area_sqm,
--        bedrooms, bathrooms, is_trending, published_at
--      status      — `.eq('status','live')` on all six public queries
--      town_id     — the `towns!inner` embed joins on it, and the location filter
--                    does `town_id.in.(...)`
--      created_at  — the final tiebreak sort key on getListings, getSimilarListings,
--                    getTopListings, getAllCards and now getSpotlightListings
--      updated_at  — app/sitemap.ts selects it AND orders by it. It is absent from the
--                    column list in docs/HANDOFF-2026-08-02.md; granting that list
--                    verbatim would have left the sitemap throwing on every crawl.
--      description — the property detail page (`getListingBySlug`)
--      property_no — NOT read by any query today. Granted because the owner decided on
--                    2026-08-02 that the property number is to be shown publicly so
--                    buyers can quote a reference in an enquiry. The grant lands here so
--                    the public render is a UI change with no second migration behind it.
--
--    DELIBERATELY WITHHELD, and each for its own reason:
--      price_php     — the whole point of this migration
--      broker_id     — an internal person reference; nothing public shows it
--      created_by    — same
--      sold_at       — no public surface shows sold dates today. NOTE FOR WHOEVER BUILDS
--                      the parked "sold listings on the public home" item: that work needs
--                      `sold_at` added here, and it will fail closed until it is.
--      search_vector — a generated tsvector. No public query uses full-text search; the
--                      location filter is `ilike` on area_detail and town name.
--
--    THE FAIL-CLOSED PROPERTY THIS BUYS, which is the durable half of the fix: once the
--    table-level grant is gone, a column added by a later migration is NOT readable by
--    anon until someone grants it here on purpose. That is precisely the trap that let
--    property_no inherit public SELECT the moment it was created.
-- ---------------------------------------------------------------------------

grant select (
  id,
  slug,
  title,
  category,
  area_detail,
  lot_area_sqm,
  floor_area_sqm,
  bedrooms,
  bathrooms,
  is_trending,
  published_at,
  created_at,
  updated_at,
  status,
  town_id,
  description,
  property_no
) on table public.listings to anon;

-- ---------------------------------------------------------------------------
-- 3. Rollback.
--
--    Restores the pre-migration state exactly: table-level SELECT/INSERT/UPDATE/DELETE/
--    REFERENCES/TRIGGER/TRUNCATE for anon, which is what `grant all` on a table means.
--    Revoking the column grants first keeps pg_attribute's ACL clean rather than leaving
--    per-column entries sitting underneath a table-level grant.
--
--    Only ever run this together with reverting web/lib/queries.ts, or the hero's ordering
--    and the grant state disagree again.
--
--    revoke select (
--      id, slug, title, category, area_detail, lot_area_sqm, floor_area_sqm, bedrooms,
--      bathrooms, is_trending, published_at, created_at, updated_at, status, town_id,
--      description, property_no
--    ) on table public.listings from anon;
--    grant all on table public.listings to anon;
-- ---------------------------------------------------------------------------
