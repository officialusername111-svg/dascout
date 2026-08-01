# run-landing-glass — landing redesign, amounts & map made admin-only

- **Run ID:** run-landing-glass · **Mode:** autonomous (design pre-approved through the
  sample-and-approve gate: mockup v3, three iterations) · **Tier:** Medium, frontend-only
- **Pre-run HEAD:** `5f7176fd89059b44c5f2dd1f0e5ca26f6f9a7005` (branch `claude/eager-hellman-4f36fe`)
- **Revert:** `git revert <run commit>` or reset the branch to the pre-run SHA.

## Approved scope (human-confirmed)

1. Hero = the new night-building photo full-bleed; headline/subtext kept top-left; the
   featured-listing **glass card** below them on the left (photo snippet, category chip,
   title, location, specs, heart, rotation dots) — no price.
2. Listing tiles per `listing_ref`: photo top with pill + heart; semibold title, gray pin
   location, gray monochrome spec icons — no price.
3. **Amounts admin-only, everywhere public** (cards, hero, property page incl. metadata,
   Market Movements panel removed, price search filter removed).
4. **Map admin-only** — removed from the public property page.
5. "Here's what you can expect from us" → pure text, no images.
6. "We Don't Just List Properties. We Verify Them." band removed; "How We Verify" links
   retargeted to `/#faq`.
7. Top utility bar (hello@…) removed from all public pages.
8. Headings: Montserrat Bold 700 via `next/font` as the licensed-safe Gotham Bold stand-in
   (approved; typography toned down per mockup v2 feedback). Body stays Figtree.

## What changed

- `app/layout.tsx` — Playfair_Display → Montserrat (`--font-head`).
- `app/globals.css` — new hero + `.glasscard` + `.spot-ctrl`; tile restructure (photo-top
  card, flow layout; photo-card border scoped to `.grid .card` so admin `.aphoto` tiles keep
  their chrome); util/verify/market/mapblock/duo styles removed; heading scale per approved
  mockup; all `--font-playfair` refs migrated.
- `components/home/HeroSpotlight.tsx` — rebuilt (rotation/pause/reduced-motion kept; card
  links to the property; FavButton on the card; `aria-live` only while stopped; a hand-picked
  dot pauses rotation).
- `components/ListingCard.tsx` — price row removed.
- `components/home/Panels.tsx` — MarketMovements + MarketRow deleted; TopProperties keeps
  views, drops the amount.
- `components/home/Sections.tsx` — AboutRows text-only; VerifyBand deleted; FAQ + testimonial
  copy de-priced.
- `components/home/SearchBar.tsx` — price filter removed (3 fields + search).
- `app/page.tsx` — UtilityBar/VerifyBand/MarketMovements gone; `price` param no longer parsed;
  empty-state copy updated.
- `app/property/[slug]/page.tsx` — price display, price-bearing metadata/OG/mailto, map block,
  UtilityBar removed.
- `components/Chrome.tsx` — UtilityBar component deleted; sidebar "Market movements" link removed.
- `app/account/layout.tsx`, both not-found pages, `app/requests/unsubscribe/page.tsx` — UtilityBar removed.
- `lib/queries.ts` — **price is no longer selected or mapped** (`price_php` out of
  `CARD_COLUMNS`/`RawListing`; `price`/`priceLabel`/`shortPrice` out of `ListingCard`), so no
  public Flight payload can carry amounts; `getMarketMovements` + its types and the price
  filter branch deleted. `lib/search-bands.ts` — PRICE_BANDS deleted.
- Assets: `public/assets/hero-night.jpg` added (1.2 MB source PNG re-encoded to 55 KB);
  six orphaned images of the removed sections deleted (hero1/2/3, card3, card7, skyline).
- Tests: `06-public-smoke` and `14-match-alerts-and-panels` rewritten to the new public truth
  (market panel absent; no ₱ in body text; no map on the property page; price_history DB
  guards kept verbatim).

## GREEN evidence

- `npm run lint` clean; `npm run build` clean (Turbopack + TS).
- Playwright: full suite 100/100 passed mid-run; after the wave-1 fixes the 9 public-surface
  specs re-ran 45/45 green (admin specs unaffected by the later changes — admin imports
  nothing from `lib/queries`).
- Page-source sweep on `/` and a property page: the only `₱` in the HTML/Flight payload is
  the request form's budget *input* placeholder (buyer's own budget — accepted in scope);
  zero `priceLabel`/`shortPrice`/`price_php` occurrences.
- Screenshots (hero, tiles, about band, property page) captured against the production build.

## Logic hunt (8 findings, all accounted for)

| ID | Finding | Outcome |
|---|---|---|
| LH-1 | Peso amounts of every listing still shipped in the RSC/Flight payload (view-source) | **Fixed** — price stripped from the public data layer itself |
| LH-2 | Glass-card heart unclickable by mouse (link overlay above it) | **Fixed** — `.glasscard .fav{z-index:2}` |
| LH-3 | Sidebar still linked to the removed `#market` section | **Fixed** — link removed |
| LH-4 | Stale copy: empty-state + FAQ "price range", testimonial "price-reduced feed" | **Fixed** — reworded |
| LH-5 | A saved listing that sells renders as a normal favorites card whose link 404s (history page handles the same state with a "Sold" pill) | **Parked — pre-existing defect, surface outside this run's intake** (proposal below) |
| LH-6 | Dead code: `getMarketMovements`+types, `PRICE_BANDS`, unreachable price filter | **Fixed** — deleted |
| LH-7 | Six orphaned images (~717 KB) still shipped | **Fixed** — deleted |
| LH-8 | a11y/UX: rotating card announced every 6 s; dot-select didn't stop rotation; spotlight still *ordered* by price | **Fixed** (first two) / **Parked** (ordering — a content decision) |

## Parked proposals (need an owner decision — nothing built)

1. **Sold favorites dead-end (LH-5):** carry listing status into the account favorites read
   and reuse the history page's sold treatment (pill, no link). Pre-existing; now the only
   place a buyer meets a sold listing, since the "Just sold" panel is gone.
2. **Sold listings have no public surface at all** anymore (grid is live-only; the panel was
   the only sold showcase). If sold social proof matters, it needs a new home.
3. **Hero featured selection is still most-expensive-first** (`getSpotlightListings` orders by
   `price_php`). Invisible to users but price-derived; `published_at` ordering would match the
   new posture.
4. Non-page amount surfaces kept intentionally (flagged for the record): match-alert emails
   include the asking price; `price_history` rows stay anon-readable via the API (asserted in
   tests as intentional).

## Notes

- Gotham Bold is commercial; Montserrat Bold ships as the approved stand-in. Drop licensed
  `.woff2` files in and swap `next/font` to `localFont` to use real Gotham.
- Design-hook findings on `app/globals.css` ("side-tab" at the search-field divider) are
  false positives: a pre-existing 1 px neutral hairline between form fields, not an accent bar.
- Worktree setup performed for verification: `npm ci` and a copy of the untracked
  `web/.env.local` from the main checkout (stays untracked).
