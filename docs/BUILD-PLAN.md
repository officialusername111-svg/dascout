# DaScout — from mockup to web application

**Status:** plan, approved to write 2026-07-28. Nothing built yet.
**Decisions already made by the owner:** Supabase for the database · Vercel for hosting · staff-run
listings first with the data model ready for brokers later · v1 includes real listings, buyer
accounts with favourites, the admin verification workflow, and property requests with email.

---

## 1. What actually changes

The current site is a static mockup: `index.html`, `property.html`, a hand-written dataset in
`listings.js`, and photos committed under `assets/`. Everything that looks dynamic is faked — the
sign-in modal validates and shrugs, favourites live in `localStorage`, and the market panels are
hardcoded rows.

The application keeps every screen you approved and replaces what's behind them:

| Today | In the application |
|---|---|
| `listings.js` array | `listings` table in Postgres |
| Photos committed in `assets/` | Supabase Storage bucket |
| Client-side filter engine | Server-side query, same URL parameters |
| Demo auth modal | Supabase Auth (real accounts) |
| Favourites in `localStorage` | `favorites` table, merged on first sign-in |
| Hardcoded "Just sold" / "Price reduced" rows | Derived from listing status and price history |
| No way to add a listing | Admin screens with a verification workflow |
| Request form that does nothing | Row in `property_requests` + email to your team |

The design does **not** change. That is a hard constraint — see §5.

---

## 2. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js, App Router, TypeScript** | Server-rendered pages so Google indexes every listing; server components can query Supabase directly with no API layer to write; the same `?cat=&loc=&price=` deep links you already have map onto `searchParams` unchanged. Use whatever is the latest stable release at install time. |
| Database / Auth / Storage | **Supabase** | One service covers Postgres, sign-in, file storage, and row-level security. Already decided. |
| DB access | **`@supabase/supabase-js` + `@supabase/ssr`** | `@supabase/ssr` is the current way to keep a session in cookies across server and browser in the App Router. Do not use the older `auth-helpers` packages — they are superseded. |
| Types | **`supabase gen types typescript`** | Generates TypeScript types straight from the schema, so a renamed column becomes a compile error instead of a blank page. |
| Styling | **The existing `styles.css`, ported as-is** | See §5. No Tailwind. |
| Forms | **Server Actions + `zod`** | Validation runs on the server where it can be trusted; the existing inline field errors carry over. |
| Images | **Supabase Storage + `next/image`** | Vercel optimises and resizes on the fly. Supabase's own image transformations are a paid add-on and aren't needed. |
| Email | **Resend** | For request notifications and match alerts. Supabase sends auth emails itself; it is not a transactional email service. |
| Schema changes | **Supabase CLI migrations** (`supabase/migrations/`) | Plain SQL files in git, applied deliberately per environment. Same discipline as an EF migration bundle — never auto-apply on deploy. |
| Tests | **Playwright** for end-to-end, **Vitest** for units | Playwright covers the journeys that matter: search → detail → save → sign in. |
| Hosting | **Vercel**, deploying from the existing GitHub repo | Already decided. GitHub Pages is retired at cutover. |

### Rejected, and why

- **ASP.NET Core MVC + SQL Server** — your usual stack, wrong project. It's built for internal LGU
  systems on Windows; DaScout is a public site whose success depends on Google indexing it, and the
  database is already settled as Supabase (Postgres).
- **Tailwind** — would mean rewriting a design system you just spent weeks approving. No.
- **Staying static on GitHub Pages** — listing pages wouldn't be indexed properly and every filter
  would stay client-side, which stops working once there are hundreds of listings.
- **A separate REST/GraphQL API** — unnecessary. Server components query Postgres directly; row-level
  security is the access control layer.
- **Algolia / Meilisearch** — Postgres full-text search with the `pg_trgm` extension handles fuzzy
  town matching fine at this scale. Revisit past ~10,000 listings.

---

## 3. How it fits together

- **Public pages** (home, listing detail, location pages) render on the server and are cached, then
  revalidated when a listing changes. Fast, and indexable.
- **Filtering** reads `searchParams` on the server and issues one query. Deep links and the back
  button keep working exactly as they do now.
- **Sessions** live in cookies via `@supabase/ssr`, so server and browser agree on who is signed in.
- **Access control is row-level security in Postgres**, not checks in the UI. The public can read
  only listings whose status is `live`. Staff can read and write everything. Brokers, when enabled,
  can write only their own rows. A page that forgets to check still can't leak.
- **The service role key never reaches the browser.** Server-only, in environment variables.

---

## 4. Data model

Enums: `listing_category` (residential_lot, farm_land, commercial_lot, residential_building,
commercial_building) · `listing_status` (draft, verifying, live, sold, withdrawn) ·
`user_role` (buyer, broker, staff, admin).

| Table | Holds | Notes |
|---|---|---|
| `profiles` | One row per account, with `role` | Created by trigger on sign-up. Role defaults to `buyer`. |
| `listings` | Title, category, price, location, area, description, status, `broker_id` | `broker_id` is nullable and unused in v1 — it's what makes the broker phase additive rather than a rewrite. |
| `listing_photos` | Storage paths, sort order, one flagged primary | |
| `features` / `listing_features` | The filter chips (Titled, Corner lot, Irrigated…) | Many-to-many, so filters stay a join rather than a text search. |
| `towns` | Town, province, and the initial letter | Powers the A–Z index and the location typeahead without scanning listings. |
| `price_history` | Every price change, with timestamp | **Required** — the "Price reduced" panel is currently faked and can't be derived without it. |
| `favorites` | Account ↔ listing | Merged from `localStorage` on first sign-in. |
| `listing_views` | View events, rolled up daily | Powers "Top Properties" for day/week/month, which is hardcoded today. |
| `property_requests` | The request form, plus the matching criteria | Used to notify buyers when a matching listing goes live. |
| `verification_events` | Who did the title check and ground validation, when, with notes | This is the audit trail behind "We verify them" — it's the promise the whole brand rests on, so it needs a record, not a checkbox. |

Trading rule to keep intact: **sale only**, five categories, prices in pesos, Mindanao locations.
Enforce the categories with the enum and prices with a check constraint rather than trusting the form.

---

## 5. The design system carries over untouched

`styles.css` is ~450 lines of custom properties, components and breakpoints that you approved screen
by screen. It is an asset, not legacy.

- Copy the `:root` custom properties (navy/gold palette, radii, shadows, motion, z-ladder) into a
  global stylesheet verbatim.
- Split component blocks (`.card`, `.rowitem`, `.frow`, `.hero`, `.duo`…) into CSS Modules beside the
  components that use them. Same declarations, narrower scope.
- Keep Playfair Display + Figtree, loaded through `next/font` so they don't flash.
- Port the markup to components in the order it appears on the page, checking each against the live
  mockup as you go.

Do not "modernise" the CSS during the port. A port and a redesign at the same time means you can't
tell which one broke the page.

---

## 6. Phases

Each phase ends with something runnable. Sizes are rough.

**Phase 0 — Foundations.** Supabase project, schema as migrations, RLS on every table, storage bucket
and its policies, Next.js app created under a new `app/` folder alongside the existing mockup, Vercel
project linked, environment variables set. *Nothing user-visible yet.*

**Phase 1 — Data in.** Seed script that reads `listings.js` and writes it to Postgres; uploader that
pushes `assets/houses/` and `assets/lots/` into Storage and links them. Verify counts match the
mockup. *The database now mirrors what you see today.*

**Phase 2 — Public site.** Design system ported, then home page and property detail rendered from the
database: search, filters, A–Z, pagination, property types, featured listings. Metadata and sitemap so
Google can index it. *Feature parity with the mockup, backed by real data.*

**Phase 3 — Accounts.** Supabase Auth wired into the existing sign-in and register modals, favourites
and browsing history moved to the account, `localStorage` merged in on first sign-in so nobody loses
saved properties. *Buyers can keep things.*

**Phase 4 — Admin and verification.** Staff sign-in, listing create and edit, photo upload with
reordering, and the lifecycle: draft → verifying → live → sold, with title-check and
ground-validation events recorded against each listing. *You can run the site without a developer.*

**Phase 5 — Requests and notifications.** Request form saves and emails your team; buyers get an email
when a matching verified listing goes live. Price changes write to `price_history`, which makes the
market panels real. *The last faked thing becomes real.*

**Phase 6 — Cutover.** Point the domain at Vercel, retire GitHub Pages, keep the mockup in the repo as
a reference until you're happy, then delete it.

**Later, not v1:** the broker portal (submission, review queue, per-broker rules), saved searches,
map search, and a Tagalog/Bisaya language toggle.

---

## 7. Risks worth naming now

- **The verification workflow is the product.** "Every listing title-checked and boundary-walked" is
  the whole promise. If admin is rushed and staff start publishing straight to `live`, the audit trail
  is empty and the claim is hollow. Phase 4 deserves the most care, not the least.
- **Photos are the bulk of the work and the cost.** Real listings mean many large images. Get the
  upload, resize and ordering right in Phase 4 or it becomes the thing that makes the admin unusable.
- **Row-level security is easy to get subtly wrong.** Every table gets a policy and a test proving an
  anonymous visitor cannot read a draft listing. Test it, don't assume it.
- **Losing saved favourites at cutover** would be a visible betrayal for early users. The
  `localStorage` merge in Phase 3 is not optional.
- **Vercel and Supabase free tiers** are fine at this size but have limits on bandwidth and database
  pauses after inactivity. Know them before launch day.

---

## 8. Open questions

1. **Domain** — is there a domain for DaScout, or does it stay on a Vercel address for now?
2. **Who gets staff accounts** at launch, and who approves a listing going live?
3. **How many real listings** exist to migrate on day one? A dozen changes nothing; a thousand changes
   the admin design.
4. **Photo rights** — are the current `assets/` photos licensed for a live commercial site, or are
   they placeholders that need replacing before launch?
