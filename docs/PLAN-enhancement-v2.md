# PLAN — Client enhancement round, v2 (2026-08-06)

> Paths below are repo-relative; prefix with `dascout/` from the workspace root.
> Source of truth for the request: `C:\Users\USER\Downloads\dascout.enhancement\`
> — `1. Dascout_Web App_Changes_v2_080526.docx` (9 numbered items, 8 screenshots),
> `Dascout.png` and `Dascout2.png` (replacement artwork, 5063×1906 each).
> **All five open decisions were answered by the owner on 2026-08-06 — see §2.**
> Nothing has been built yet.

---

## 1. The nine items, checked against the code

| # | Client asks | Where it lands | Current state | Size |
|---|---|---|---|---|
| 1 | Hero background: zoom into the building, more black, less building | `app/globals.css:103` (`.hero`), `public/assets/hero-night2.jpg` | Full-bleed `center/cover` with a `::before` scrim | S |
| 2 | "Find Your Best Property" card — more glossy/glassy | `app/globals.css:145+`, `components/home/SearchBar.tsx` | Already "white glass"; asks for more | S |
| 3 | Replace "Here's what you can expect from us" with supplied art | `components/home/Sections.tsx` → `AboutRows()` | Built in HTML: 4 icon cards + CTA | M |
| 4 | Replace "We Don't Just List Properties" with supplied art; Get Started Today under the description | `components/home/Sections.tsx` → `VerifiedBand()` | Built in HTML; **button is already below the description** (`:91`) | M |
| 5 | Asking price: make it hideable or not | `components/admin/ListingForm.tsx:217-231` + DB + grants | Price is admin-only everywhere; anon has no column grant | L |
| 6 | "About this property": editable font, size, bold, alignment, colour | `ListingForm.tsx:360-372` + `app/property/[slug]/page.tsx:92-97` | Plain `<textarea>` → plain `<p>` | L |
| 7 | Note under Inquire: "All inquiries … handled exclusively through Dascout" | `app/property/[slug]/page.tsx:113-121` | Not present | S |
| 8 | Inquire button reaches +63 920 668 5742 and dascoutph@gmail.com | `app/property/[slug]/page.tsx:114-119` | mailto to dascoutph@gmail.com already works; **no phone anywhere** | S |
| 9 | Clear the property listing database | Supabase (listings + 2 storage buckets + dependents) | 12 listings, `001`–`012` — **all test data** | Gated |

Two items are already partly done: #4's button exists, and #8's email already works.

---

## 2. Decisions — ANSWERED 2026-08-06

| # | Question | Owner's answer |
|---|---|---|
| D1 | Banners: flat image or rebuilt in HTML? | **Flat images as sent** — except `Dascout.png`, see D2 |
| D2 | `Dascout.png` typo ("expects") | **Rebuild that one in HTML/CSS with the sprite icons, exactly matching the artwork; fix "expects" → "expect"** |
| D3 | Price visibility | **Add an option to hide or show the price** |
| D4 | Hero photo | **Just zoom the current image** — no new asset needed |
| D5 | Clearing the listings | **On the owner's signal. All site data is test data.** |

Two consequences to carry forward:

- **D2 splits the banners.** `Dascout2.png` (Buyers & Sellers) ships as a flat image.
  `Dascout.png` (expectations band) is rebuilt in code. They are different jobs.
- **D3 reverses a standing rule.** `CLAUDE.md` and `BACKLOG.md` currently say *"No peso amounts
  and no map anywhere public."* Once the toggle ships, that sentence is no longer true and both
  files must be corrected in the same change (task D5 below). The map half stays.

---

## 3. Task list

Phases are ordered so the safe work ships first. Within a phase, tasks run top to bottom.

### Phase A — Home page visuals · items 1, 2, 3, 4 · `/design-me`
No database, no data, fully revertible.

| ID | Task | Done when |
|---|---|---|
| A1 | **Sample first** — static mockup of the home page with the zoomed hero, glassier search card, rebuilt expectations band and the flat Buyers & Sellers banner | Owner approves. Raise at this point: the artwork has **no "See Verified Listings" button**, but `Sections.tsx:44` has one — confirm it is meant to go |
| A2 | Hero zoom — tighten `background-size`/`background-position` on `.hero` and deepen the `.hero::before` scrim so the building reads as a small lit detail on black | Matches the brief at 375 px, 768 px and desktop |
| A3 | Search card — more blur, more translucency, brighter edge highlight on the `.search` block | Reads as glass over the hero, text still passes contrast |
| A4 | Rebuild `AboutRows()` to match `Dascout.png`: dark glossy 2×2 cards, gold icons, heading `Here's what you can expect from us.` with `from us.` in gold, **"expect" spelled correctly** | Side-by-side with the artwork shows no meaningful difference |
| A5 | Add a gem/diamond icon to `components/IconSprite.tsx` — the artwork's fourth icon is a gem; the sprite only has `i-star` | New `i-gem` renders at the card size |
| A6 | Replace `VerifiedBand()` with `Dascout2.png` as a flat image; keep the **Get started today** button directly beneath it | Button sits under the banner; `verified-fields.jpg` no longer referenced |
| A7 | Compress `Dascout2.png` and produce responsive variants — **6.6 MB at 5063 px wide is not shippable** | Largest variant well under 400 KB |
| A8 | Alt text for the flat banner carrying the full paragraph, since the words are inside the picture | Screen reader reads the whole statement |

**Verification:** Vitest, then eyeball at three widths. No E2E — no behaviour changed.

### Phase B — Listing contact block · items 7, 8 · small, inline
Blocked on nothing. Can ship first.

| ID | Task | Done when |
|---|---|---|
| B1 | Add the note under the Inquire button: *"All inquiries for this property are handled exclusively through Dascout"* | Visible on every listing detail page |
| B2 | Add the phone as `tel:+639206685742`, displayed `+63 920 668 5742`, using the existing `i-phone` sprite icon | Tapping it dials on mobile |

**Verification:** Vitest + `03-listing-journey.spec.ts` against a production build.

### Phase C — Rich-text description · item 6 · `/do-me`
Changes stored data. Its own phase.

| ID | Task | Done when |
|---|---|---|
| C1 | Migration: add `listings.description_html`; backfill from `description`; keep `description` as plain text | Applied via Supabase MCP at owner's OK |
| C2 | Add the editor dependency; toolbar limited to bold, italic, underline, size, alignment, colour, lists. **No image insert** — `img-src` in `proxy.ts:57` blocks remote images | Admin can format and save |
| C3 | Add an HTML sanitiser; sanitise **server-side on save** against a tag/attribute allowlist | Hostile markup never reaches the database |
| C4 | Sanitiser unit tests with hostile input — `<script>`, `onerror=`, `javascript:` hrefs | All rejected |
| C5 | Public render at `page.tsx:92-97` switches to sanitised HTML; extend `.desc` styles for headings and lists | Formatting shows on the live page |
| C6 | Fixed brand-safe colour palette rather than a free colour picker | Nobody can set light grey on white |

**Why C3 is not optional:** stored HTML rendered back to visitors makes any admin account a
stored-XSS vector against everyone who opens the listing. This is the security requirement of
the round. `description` stays plain text because `lib/match-alerts.ts:120` and the SEO meta
path both consume it and must not receive markup.

### Phase D — Price visibility · item 5 · `/build-me`
Touches grants. Sequencing is load-bearing.

| ID | Task | Done when |
|---|---|---|
| D1 | Migration: `listings.price_public boolean not null default false` | Applied; existing listings stay hidden |
| D2 | Create view `listings_public` exposing `case when price_public then price_php end as price_php`; grant to `anon`. **Base column stays ungranted.** Grant lands BEFORE the code that uses it | Anon can read price only for opted-in rows |
| D3 | Admin: show/hide control beside Asking price in `ListingForm.tsx:217` | Toggle persists |
| D4 | Public: render price on listing detail and cards when public. Sample the hidden-state label first ("Price on request"?) | Owner approves the hidden-state wording |
| D5 | Correct the standing-rule text in `CLAUDE.md` and `docs/BACKLOG.md` — "no peso anywhere public" no longer holds. **Ships in the same change** | Both files match reality |

**A per-row toggle cannot be done with column grants** — grants are per column, not per row.
Re-granting `price_php` to `anon` outright would re-open the exposure closed on 2026-08-02;
the view is what keeps the base table locked while letting the toggle decide per row.
**A grant that widens lands before the code; a grant that narrows lands after it** — backwards
took the site down for ten minutes on 2026-08-02.

### Phase E — Clear the listings · item 9 · ON THE OWNER'S SIGNAL ONLY
All site data is test data (owner, 2026-08-06), so this is lower risk than first assessed — but
it is still irreversible and still runs alone.

| ID | Task | Done when |
|---|---|---|
| E1 | Export a backup through the Supabase MCP (no Docker, so no `pg_dump`) | Backup saved and readable |
| E2 | Clear `listings` and dependents: favorites, price history, engagement/visit records, `property_requests` | No orphaned rows |
| E3 | Clear both storage buckets of the now-orphaned photos — deleting rows does **not** remove the files | Neither bucket holds listing photos |
| E4 | Decide whether `property_no` restarts at `001` or the numbers are retired | Owner's call recorded |
| E5 | Verify `sitemap.ts` and the live site with zero listings | Site renders cleanly empty |

No service-role key, no automated purge — existing policy stands.

---

## 4. Requirements

**New dependencies** — one rich-text editor and one HTML sanitiser (Phase C). Both are new
ground: the repo runs on Next 16.2.12, React 19.2.4, `@supabase/*` and zod, nothing else.
The CSP already allows `style-src 'unsafe-inline'` (`proxy.ts:55`) so editor inline styles
render; `img-src` (`:57`) is `'self' data: blob:` plus the Supabase origin, so remote images
would be blocked — the editor must not offer image insert.

**Migrations** — one for Phase C (`description_html`), two steps for Phase D (`price_public`,
then the view + grant). Applied through the Supabase MCP at the owner's OK; there is no Docker
on this machine.

**Assets** — `Dascout2.png` needs compressing and responsive variants before it ships (A7).
`Dascout.png` is not shipped at all; it becomes code (A4).

**Verification bar** — Vitest + `03-listing-journey.spec.ts`, both against a production build.
Playwright needs `npm run build` first and takes port 3000; stop any dev preview. The E2E suite
writes to the live database, so prefer targeted specs.

---

## 5. Order of work

**B → A → C → D → E.** Phase B is blocked on nothing and ships first. Phase A needs its sample
approved. C and D are independent of each other. E waits for the signal.
