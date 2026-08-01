# Home page redesign v6 — approved spec, not yet built

**Approved:** 2026-08-01 by the owner, after three mockup rounds (v4 → v5 → v6).
**Status:** design approved, **zero implementation done**. Main is at `6d749b7`, tree clean, tests green.
**Frozen mockup:** [`docs/mockups/home-v6-approved.html`](mockups/home-v6-approved.html) — self-contained,
open it in a browser. Also published at https://claude.ai/code/artifact/ed2470ca-1ed2-4a2a-9240-05c36da1a4dc
**Owner's reference screenshots:** [`docs/refs/`](refs/)

The mockup is the contract. Where this document and the mockup disagree, the mockup wins — it is what
the owner actually looked at and approved. Read its CSS directly; it was written against the real
`globals.css` so most rules transfer with only selector renaming.

---

## 1. Palette — navy becomes black (site-wide)

This is **not** a home-page-only change. Every surface using the navy ramp repaints: header, footer,
sidebar, buttons, admin screens, account pages, dialogs.

| Old token | Old value | New value | Used for |
|---|---|---|---|
| `--navy-950` | `#081527` | `#000000` | footer ground |
| `--navy-900` | `#0B1D33` | `#0D0D0F` | header, dark bands, primary buttons, pills |
| `--navy-800` | `#122A47` | `#1C1C20` | raised dark surfaces, avatars |
| `--navy-700` | `#1B3A5E` | `#2E2E34` | hover states |
| `--ink` | `#152030` | `#16161A` | body text (was navy-tinted) |
| `--ink-2` | `#49566A` | `#52525B` | secondary text |
| `--ink-3` | `#77828F` | `#7A7A83` | tertiary text, field labels |

Gold (`--gold`, `--gold-d`, `--gold-l`, `--on-gold`), `--bg`, `--bg-2` (`#F6F4EE`) and `--line` are
**unchanged** — the warm cream ground carries black better than it carried navy.

**Rename the tokens** `--navy-*` → `--ink-950/900/800/700`. Leaving black values behind navy names is a
trap for the next reader. Grep the whole `web/` tree, not just `globals.css` — several components
reference navy tokens inline, and `.btn-navy` is used in markup across admin, account and dialog code
(rename to `.btn-dark`).

Also update the hero scrim: `rgba(5,11,20,…)` → `rgba(0,0,0,…)`.

## 2. Hero

New backdrop: **`web/public/assets/hero-night2.jpg`** (already committed; re-encoded from the owner's
1.6 MB `header_photo_2.png` to 104 KB). The old `hero-night.jpg` becomes orphaned — delete it.

Structure changes from a 2-column grid to a stacked block:

```
.hero .in          → plain block, padding 56px 24px 52px
  .hero .lead      → label, h1, sub, single CTA. max-width 640px, margin-bottom 32px
  .hero .row       → display:flex; align-items:center; justify-content:space-between; gap:24px
      .glasscard   → 404px, on the left
      .searchcard  → 562px, on the right
```

`space-between` leaves a gap in the middle where the building in the photo stays visible. Keep it.

The hero CTA row keeps **only** "See Verified Listings". "How We Verify" is dropped (its FAQ target is
being removed) — this was the owner's explicit choice.

### 2a. Featured listing card — photo only

Rebuilt in `components/home/HeroSpotlight.tsx`. It is now **a photograph with overlays**, nothing else:

- Full-bleed `<img>`, height 322px, `object-fit:cover`, card `overflow:hidden`, radius 20px.
- A scrim `<span>` — `linear-gradient(to top, rgba(0,0,0,.88), rgba(0,0,0,.55) 38%, transparent)`,
  bottom 68% of the card, `pointer-events:none`.
- Heart button stays top-right.
- **Name + location move onto the image** (absolute, left/right 20px, bottom 54px) with
  `text-shadow` so they survive a bright photo.
- **Removed:** the "Featured · <category>" gold chip, and the whole bed/bath/sqm specs row.
- Rotation dots + pause sit bottom-left, absolute.

`Specs` is no longer imported here — check whether `components/ListingCard.tsx` still needs to export it
(the grid tiles do, so it stays exported).

### 2b. Search card — white glass, fields inline

`components/home/SearchBar.tsx` moves **into the hero** and stops being a standalone strip.

- `background:rgba(255,255,255,.80)` + `backdrop-filter:blur(18px) saturate(1.5)`, white border,
  radius 18px. **Include the `@supports not (backdrop-filter…)` fallback** at `rgba(255,255,255,.95)` —
  same pattern the old `.glasscard` used.
- Heading `Find Your Best Property` (18px).
- Three fields **on one line** (`grid-template-columns:1fr 1fr 1fr`, gap 10px): Location, Property type,
  Lot / floor area. Same names/values the form submits today (`loc`, `cat`, `size`).
- **Location becomes a `<select>`**, first option **"All locations"** (empty value), then the town list.
  It is a free-text `<input list=townList>` today — the datalist goes away with it.
- Full-width dark submit button "Search Property" with a white circular arrow pinned right.
- No Buy/Rent/Invest tabs — DaScout is sale-only. (Deliberate departure from `search_ref`.)
- Keep the no-JS path: real `<form method="get" action="/">`, JS only intercepts to push the URL.

## 3. Removed outright

From under the hero (the owner's `remove_element_1` crop, **all of it**):
- the standalone `.searchbar` strip (moved, above)
- the `.search-status` results line
- the `.trust` strip (Title-verified / Trusted by thousands / Licensed brokers / Secure transactions)
- the **entire Explore Property Types section** (`TypeTiles`, the 5 category tiles + "View all →")

Sections removed from the page:
- `Testimonials` — What Our Clients Say
- `RequestBand` — Can't find it? Request it.
- `LocationsAndFaq` — Browse by Location **and** Frequently Asked Questions

Both "How We Verify" buttons are dropped (hero + the Direct Owner Access card), because their `/#faq`
target no longer exists. Grep for `#faq`, `#types`, `#market` and `#locations` before finishing —
the sidebar and footer may still link to removed anchors.

Delete the now-dead code: `TypeTiles`, `Testimonials`, `LocationsAndFaq`, `FAQS`, `QUOTES`, the
`ClearFiltersLink` export, `getCategoryCounts`, `getTowns`'s A–Z `initials` use, and the
`az` filter if nothing else consumes it. Check `getPopularFeatures` — the sidebar may still need it.

**Filter feedback must not be lost.** Removing `.search-status` removes the only "Clear filters" escape
from a filtered page. Move that message into the Featured Listings subtitle: when filters are active,
the `<p>` under the "Featured Listings" heading shows `describeFilters(...)` plus a Clear filters link
instead of "Fresh on the market across Mindanao." The favorites view (`?favs=1`) uses the same slot.

## 4. Tab pills — a real bug fix

`.tabs button, .tabs a` are `display:block` with `min-height:44px`, so labels sit at the **top** of the
pill instead of centred. Fix:

```css
.tabs button,.tabs a{display:inline-flex;align-items:center;justify-content:center; …}
```

This straightens both the Featured Listings (All/Trending/Random) and Top Properties (Day/Week/Month)
tabs. It is a global `.tabs` fix — check admin screens for other `.tabs` users.

## 5. "Here's what you can expect from us" — new layout

`AboutRows` in `components/home/Sections.tsx` is re-laid-out per the owner's `expect_from_us_ref`:

- A dark (`--ink-900`) rounded band, `grid-template-columns:minmax(260px,.85fr) 1.15fr`, gap 40px.
- **Left:** the section heading (white, gold `<em>`), the existing subtitle, and one gold
  "See Verified Listings" button.
- **Right:** four white cards in a **2×2 grid** — icon tile, bold title, body text.
- **Real Support is deleted** (owner's instruction), which is exactly what makes the 2×2 work.
- **No links on any of the four cards.** The three `→` links (See Verified Listings, Request a Property,
  View Top Properties) were removed in v6.

⚠️ **Open item the owner has not answered:** removing "Request a Property →" leaves the request form
reachable only from the sidebar. Ask before building whether it should be re-added somewhere (hero or
the verified band are the natural homes). Do not silently drop the entry point.

## 6. "We Don't Just List Properties. We Verify Them." — new section

New, laid out per `docs/refs/verified_layout.png`. Goes **after** the expectations band and **before**
Top Properties, so the account CTA lands while someone is still deciding.

- Light band (`--bg-2`), radius 20px, padding 26px, two equal columns, gap 34px.
- **Left:** `web/public/assets/verified-fields.jpg` (already committed — the owner's aerial rice-field
  photo, re-encoded from 3 MB to 139 KB), `object-fit:cover`, radius 16px, min-height 330px.
  Alt text: describe the aerial highway/rice fields, not "verified".
- **Right:** heading `We Don't Just List Properties. <em>We Verify Them.</em>`, the body copy below,
  and a gold "Get started today →" button opening the account/sign-up flow.

Body copy, as approved:

> DaScout exists because real estate shouldn't run on trust alone — it should run on proof. We're
> Mindanao's exclusive, verified real estate platform, built for buyers who can't be everywhere at
> once: OFWs, investors, and professionals purchasing property from thousands of miles away. Every
> listing is title-checked, boundary-walked, and confirmed on the ground before it ever reaches you,
> because owning property should feel like a decision, not a leap of faith.

The reference's closing line "Create a free account to save favorites and follow listings" is
deliberately **not** a sentence — it is the button.

## 7. Footer — real contact details

Replace the single `hello@dascoutprime.com` line with a three-column footer plus a bottom bar:

- Brand column: logo + one-line blurb.
- **Get in touch:** `0920 668 5742` (`tel:+639206685742`), `dascoutph@gmail.com` (`mailto:`),
  and `DaScout on Facebook` → `https://www.facebook.com/profile.php?id=61582876857220`
  (`target="_blank" rel="noopener noreferrer"`). Gold icons.
- Browse column: All listings, Top properties, Create a free account.
- Bottom bar: copyright + "General Santos City, SOCCSKSARGEN".

Grep for `hello@dascoutprime.com` elsewhere — it may appear in metadata, emails or the property page's
mailto, and the owner has now given the real address.

## Final page order

Header → Hero (headline + featured tile + search card) → Featured Listings → Expect from us →
We Verify Them → Top Properties → Continue Browsing → Footer.

## Constraints that still bind

- **No peso amounts and no map anywhere public**, enforced at the data layer: public queries never
  select `price_php`. Nothing in this redesign reintroduces either — keep it that way.
- Fonts stay Montserrat (headings) / Figtree (body) via `next/font`. The mockup uses system
  stand-ins only because the artifact CSP blocks font CDNs.
- Tests to update: `06-public-smoke` and `14-match-alerts-and-panels` assert on the current home
  page (market panel absent, no `₱`); the removed sections and moved search will need their
  selectors revised. `09-account-favorites-merge` is unaffected.
