# run-v6-home-black — v6 home redesign + site-wide navy→black

**Terminal state:** `done-green` · **Tier:** Large · **Domain:** frontend
**Pre-run HEAD:** `e95e46b` · **Route:** do-me → redesign-me (thin pass-through)
**Date:** 2026-08-01

Built the home redesign approved in `docs/REDESIGN-SPEC-v6.md`, contract-frozen at
`docs/mockups/home-v6-approved.html`. The approval gate was **not** re-opened.

## Owner decisions taken at intake

1. **Request a Property — remove the entry points.** Asked as instructed. The owner first said
   "remove it. And the function it is doing. There is no request a property." Because the request
   rows are what `match-alerts.ts` runs on, the blast radius was put back to the owner, who chose
   **UI-only removal**: every visible entry point goes, the data layer stays. Nothing was dropped
   at the database.

## What changed

- **Palette (site-wide).** `--navy-950/900/800/700` renamed to `--ink-950/900/800/700` and
  revalued to `#000000 / #0D0D0F / #1C1C20 / #2E2E34`; `--ink`, `--ink-2`, `--ink-3` revalued.
  `.btn-navy` → `.btn-dark` across 22 markup sites. Gold, `--bg`, `--bg-2` and `--line` unchanged.
  Shadows, the sidebar scrim and the dialog backdrop repainted from navy-tinted rgba to black.
  `--bg-hero` deleted (declared, never referenced).
- **Hero.** New `hero-night2.jpg` backdrop, black scrim gradient, grid → stacked block, headline
  block plus a `space-between` row holding the 404px featured tile and the 562px search card.
  Single "See Verified Listings" CTA; "How We Verify" dropped with its FAQ target.
- **Featured tile.** Now a photograph with overlays only — title and location ride on the image
  over a fade, heart top-right, dots and pause bottom-left. Category chip and specs row removed.
- **Search card.** Moved into the hero as white glass with the no-blur fallback; three fields on
  one line; Location is now a `<select>` led by "All locations"; dark full-width submit with the
  white circular arrow. The no-JS GET form path is preserved.
- **Removed.** The search strip, results line, trust strip, Explore Property Types, Testimonials,
  Request band, Browse by Location and the FAQ — plus the dead code behind them
  (`TypeTiles`, `Testimonials`, `LocationsAndFaq`, `FAQS`, `QUOTES`, `ClearFiltersLink`,
  `getCategoryCounts`, the `az` filter and `TownRow.initial`).
- **Filter feedback preserved.** With `.search-status` gone, the Featured Listings subtitle now
  carries `describeFilters(...)` plus the Clear-filters link; `?favs=1` uses the same slot. Without
  this, a filtered page would have had no escape.
- **`.tabs` bug fix.** Pills were `display:block`, so labels sat at the top of the 44px target.
  Now `inline-flex` + centred — fixes Featured Listings, Top Properties and the admin status filter.
- **Expect band.** Dark band, copy + one gold CTA left, 2×2 white cards right, no links on cards,
  "Real Support" deleted.
- **New verified band.** `verified-fields.jpg` left, approved copy right, gold "Get started today"
  opening the sign-up flow. Sits after the expect band, before Top Properties.
- **Footer.** Three columns (brand / Get in touch / Browse) plus a bottom bar, with the owner's
  real phone, email and Facebook page. The property page's placeholder `hello@dascout.ph` mailto
  was updated to the same real address.
- **Request UI removed:** `RequestBand`, the card CTA, `RequestButton`, the sidebar item, the
  footer link, `RequestDialog`, and the `requestOpen`/`openRequest` context slice. **Kept and
  proven working:** `property_requests`, its 7 migrations, `lib/match-alerts.ts`, the admin
  requests inbox, and the confirm and unsubscribe routes.

## Deviations from the mockup, and why

- **Card gradient is `.fade`, not `.scrim`.** `.scrim` is already the sidebar backdrop and carries
  `opacity:0`; reusing the name would have rendered the gradient invisible.
- **Heart stays 44px** (mockup: 38px) — the accessible touch-target floor the rest of the site
  holds to. Invisible against a photo.
- **`.sf select` is 14px on desktop per the mockup, 16px under 880px** — 16px is the floor that
  stops iOS Safari zooming the page on focus.
- **The transaction disclaimer was kept**, on its own line under the new bottom bar. The mockup's
  bar shows only copyright and location; silently dropping a liability notice is not a layout
  decision.
- **Header nav:** the dead `Locations` and `FAQ` links were replaced by one live `Top Properties`
  link rather than left pointing at removed anchors.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | pass |
| `eslint` | pass, 0 warnings |
| `next build` | pass — 17 routes, incl. `/admin/requests`, `/requests/confirm`, `/requests/unsubscribe` |
| Vitest | **136/136** |
| Playwright | **101/101** |
| Browser check | hero, expect band, verified band and footer confirmed at 1360px; 404px + 562px measured; zero console errors |

`13-request-form.spec.ts` was **deleted**, not repaired — it drove the removed dialog through the
UI. `14`, `16` and `17` insert `property_requests` rows directly via the service client, so the
retained backend kept its full executed proof and all three pass.

Two specs failed on the first full run because the `btn-navy` sweep had not covered `tests/`:
`01-auth-and-noindex` (stale `a.btn.btn-navy.abtn-sm`) and `12-csp-nonce` (opened the removed
request dialog as its hydration probe; now probes the auth dialog). Both fixed, both green.

## Parked proposals (not built)

- **P1 — stale `?loc=` values show "All locations".** Location is now a `<select>`; a URL carrying
  a `loc` value that matches no option leaves the control on "All locations" while the grid stays
  filtered. Self-correcting — the subtitle still names the filter and offers Clear filters — so it
  was left alone rather than grown into new work.
- **P2 — old `?az=` links no longer filter.** The A–Z filter is gone; such URLs now return
  everything instead of erroring. No sitemap or internal link emits them.
