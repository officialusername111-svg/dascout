# DaScout Redesign Spec v2 — HomeVista structure · navy+gold · Web App Changes v1 content

Approved direction: HomeVista reference screenshot defines the page structure; the Web App
Changes v1 document governs content; palette is deep navy + gold (v1 decision). Stack unchanged:
static HTML + CSS + vanilla JS, no new dependencies. Scope: index.html, styles.css, property.html.

## Design tokens
- Navy scale `#081527 / #0B1D33 / #122A47 / #1B3A5E`; gold `#D4AF5A` (light `#E9CE8F`, dark `#B8923E`)
- Light theme: white surfaces, `#F6F4EE` alternate band, line `#E7E4DA`
- Type: Playfair Display (display/serif accents), Figtree (UI/body). Caveat script removed.
- Motion tokens: `--dur-1: 150ms`, `--dur-2: 220ms`, `--ease` standard curve; transform/opacity only;
  `prefers-reduced-motion` kills transitions AND the JS rotator.

## Homepage structure (top → bottom)
1. Utility bar (navy-950): contact email/phone/location + socials
2. Header (white, sticky): logo image · nav Home/Lots/Farm Land/Buildings/Locations/FAQ
   (category links carry real `?cat=` params) · favorites button · Sign In · Create Account (gold)
3. Hero (light): verified badge · serif H1 "Own a Property *Across Mindanao*" · Registry subcopy ·
   CTAs "See Verified Listings" → #listings, "How We Verify" → #verify · trusted-by avatars ·
   photo panel with floating spotlight card (3-listing rotator: dots + pause button, hover/hidden
   pause, reduced-motion → static)
4. Search bar (white card overlapping hero): location (datalist typeahead of towns) · type ·
   price · size · Search. Filters the grid, syncs to URL params, shows count + clear, designed
   zero-results state
5. Trust strip: 4 trust items (title-verified, trusted, licensed brokers, secure)
6. Explore Property Types: 5 icon cards, counts computed from LISTINGS, click = filter
7. Featured Listings: tabs All/Trending/Random · card grid (real `<a>` cards) · working
   pagination (12/page) · functional favorites (localStorage, aria-pressed, status feedback)
8. Top Properties: Day/Week/Month tabs · ranked rows as real links
9. Continue Browsing: driven by real localStorage view history; honest empty state; working
   "Clear history"
10. Market Movements: New/Reduced/Sold tabs · rows as real links
11. "Here's what you can expect from us": 5 cards (v1 Canva content) on alternate band
12. Verify band (id="verify"): skyline photo · "We Don't Just List Properties. We Verify Them." ·
    v1 paragraph · Create a Free Account CTA · inline stats (+840/+650/+45/+10)
13. Testimonials: all 4 quotes kept, reworded (no tripping/broker-listing claims)
14. Request band → opens request dialog
15. Browse by Location (A–Z + popular, links carry `?loc=` filters) + FAQ (tripping and
    list-my-property items removed; "How are listings verified?" added)
16. Footer: 4 columns (brand/quick links/property types/contact) + v1 fine print

## Property page
New shell (utility bar/header/footer), gallery + thumbs, info panel, features,
CTAs: "Inquire about this property" (mailto+account prompt) + functional Save,
NEW: Location block with Google Maps embed (iframe, `q=<listing.loc>`), similar properties as
real links, not-found state kept.

## Removed per v1 (not lost — removed on purpose)
Share strip · Lite promo · list-your-property promo · site-tripping schedule + all tripping copy ·
"Trippings" nav · tripping FAQ · list-property FAQ · owner/broker registration roles ·
"List a property" buttons (→ Sign In / Create Account) · Caveat script styling · "chosen just for you".

## Audit fixes built in (ref: 8-file library findings)
Real `<a>` links for cards/rows (NAV §4.1/§9.3) · no dead `#` links — every link goes somewhere
real or is a `<button>` (NAV §4.2) · search inputs actually filter (FORMS §5.5) · form feedback:
inline validation + status regions + success acknowledgment, double-submit guard (S&F §4/§5) ·
`<dialog>` modals: native trap/inert/Esc/scroll-lock, focus restore (OVERLAYS §2/§9) · rotator
pause + reduced-motion (MOTION §9.6) · 16px inputs (FORMS §8.3) · fake CAPTCHA removed, password
show/hide added (FORMS §3.6/§9.1) · skip link + `<main>` + aria-current (NAV §9.1/§1.2) · URL
state for filters (NAV §6) · 44px touch targets, ≥8px gaps (TOUCH §1) · aria-live on swapped
regions (S&F §7) · z-index ladder tokens (OVERLAYS §7.2) · property page gets mobile nav (NAV §7.6).

## Old → new map (homepage)
| Existing element | New location / treatment |
|---|---|
| Header nav Lots/Farm Land/Buildings/Locations/FAQ | Header, unchanged labels, real `?cat=` filter links; Trippings removed (v1) |
| "List a property" button | Replaced: Sign In + Create Account (v1) |
| Hero headline/sub/search card/spotlight/trust bar | Hero (new copy per v1) + overlapping search bar + trust strip; spotlight → floating card rotator |
| Share strip, promos | Removed (v1) |
| Featured listings + tabs + pagination | Section 7, same tabs, real pagination |
| Top properties + Day/Week/Month | Section 8 unchanged content |
| Continue browsing + Clear history | Section 9, now real history, working clear |
| Market movements 3 columns | Section 10 unchanged content |
| Site tripping schedule | Removed (v1) |
| Browse by location | Section 15, full width of its column, real filter links |
| Feature band "Property-hunting made simple" | Replaced by "What you can expect" 5 cards (v1) |
| Stats | Inline in verify band |
| Lifestyle CTA "Unlock the door" | Verify band with v1 copy + skyline photo |
| Testimonials (4) | Section 13, reworded |
| FAQ (4 items) | Section 15: 2 reworded + 1 new; 2 removed (v1) |
| Footer CTA/links/fine print | Rich 4-column footer, v1 fine print |
| Auth modal (3 tabs) | `<dialog>`, buyer-focused register, show/hide password, no fake CAPTCHA |
| Request modal | `<dialog>`, reachable from request band + sidebar + footer |
| Mobile sidebar | Kept: browse/types/features/request — all links functional filters |

States: every dynamic region has designed empty/zero-results/success/error states; favorites and
history degrade gracefully without localStorage. Breakpoints: 320 / 640 / 960 / 1220.
