# Phase 4 — Admin and verification · intake brief

Written 2026-07-29 at the end of the Phase 2 session, for whoever starts Phase 4 in a fresh
session. Read this, then `BUILD-PLAN.md` §4 (data model) and §7 (risks). Everything below was
verified against the running system, not remembered.

---

## What Phase 4 is

From the build plan: *staff sign-in, listing create and edit, photo upload with reordering, and the
lifecycle draft → verifying → live → sold, with title-check and ground-validation events recorded
against each listing.* The outcome is "you can run the site without a developer."

The plan also says this phase **deserves the most care, not the least**: the whole DaScout promise is
"every listing title-checked and boundary-walked." If staff can publish straight to `live`, the audit
trail is empty and the claim is hollow.

---

## Where the project actually is

| | State |
|---|---|
| Phase 0 — schema, RLS, storage | Done. 11 tables, 4 enums, RLS everywhere |
| Phase 1 — data + photos in | Done. 12 listings, 36 photo rows, 28 files in the bucket |
| Phase 2 — public site | Done and **live at https://dascoutprime.com** |
| Phase 3 — buyer accounts | **Not started** — see the sequencing question below |
| Phase 4 — admin | Not started. This brief |

- Repo root: `D:\Workspace\DaScout\dascout` (git root is this folder, not the workspace root).
- App: `web/` — Next.js 16.2.12, React 19, App Router, TypeScript, no Tailwind.
- Hosting: Vercel project `dascout`, **Root Directory `web`**, auto-deploys on push to `main`.
- Supabase project `kogpuuidawbmttyswvsx`.
- `web/AGENTS.md` warns Next 16 differs from training data — read `node_modules/next/dist/docs/`
  before writing Next code. `middleware` is called `proxy` in this version.

---

## Read these first

- `docs/BUILD-PLAN.md` — data model, phases, risks.
- `supabase/README.md` — schema notes from Phase 0.
- `supabase/migrations/` — **only the five from 2026-07-29 are here.** The six earlier ones were
  applied straight to the hosted project and exist only in Supabase's migration table. Exporting
  them is a small, worthwhile job.
- `lib/queries.ts` — every database read the public site makes. Admin writes should follow the same
  shape: one module owning the data access, pages never touching the Supabase client directly.

---

## Two things that will bite on day one

### 1. There is no way to create the first admin through the app

`auth.users` and `public.profiles` are both **empty**. Signing up creates a profile with role
`buyer` (the `handle_new_user` trigger). Promoting it needs an `UPDATE`, and
`profiles_guard_role` — `BEFORE UPDATE`, `SECURITY DEFINER` — raises unless `is_staff()` is already
true. Nobody is staff, so the guard blocks the first promotion. Verified, not theorised.

The bootstrap is therefore a deliberate one-off:

```sql
alter table public.profiles disable trigger profiles_guard_role;
update public.profiles set role = 'admin' where id = '<the new auth user id>';
alter table public.profiles enable trigger profiles_guard_role;
```

Do it once, for the owner's account, and record it. Do **not** weaken the guard to make this
easier — it is the thing stopping a buyer from promoting themselves.

### 2. Draft photos must not go in the current bucket

`listing-photos` is **public**. That is correct for published listings and is what makes the site
work. But filenames are predictable (`houses/h08.jpg`, `lots/l09.jpg`), and a public bucket serves
any object whose path someone knows or guesses — regardless of the listing's status.

So a draft listing's photos, uploaded through the new admin screen, would be fetchable before the
listing is verified. **Create a second, private bucket for unpublished photos and move objects across
on publish**, or accept and document the exposure. This is a design decision to make before the
upload screen is built, not after.

Current bucket limits (set 2026-07-29): 10 MB per file, `image/jpeg`, `image/png`, `image/webp`.
Writes require `authenticated` **and** `is_staff()`. Anonymous users cannot list the bucket — verified.

---

## What the database already gives you

Don't rebuild these; they exist and work.

| Thing | What it does |
|---|---|
| `listing_status` enum | `draft`, `verifying`, `live`, `sold`, `withdrawn` |
| `listings_sync_timestamps` trigger | Stamps `published_at` / `sold_at` on the status change |
| `listings_record_price_change` trigger | Writes every price change to `price_history` — this is what makes the home page's "Price reduced" panel real. It is empty today only because no price has changed |
| `verification_events` table | `title_check`, `ground_validation`, `published`, with who/when/notes. Staff-only. **Currently 0 rows** — the audit trail the brand rests on has never been written to |
| `is_staff()` | `SECURITY DEFINER`, `search_path` pinned, granted to `authenticated` only |
| `listings_staff_write`, `listing_photos_staff_write`, … | Staff write policies already exist on every table |

Public reads are limited to `live` and `sold`. An anonymous visitor already cannot see a draft —
verified by probe on 2026-07-29. **Keep a test proving that**, per the build plan's risk list.

---

## Decisions already made — do not re-litigate

- Stack is Next.js + Supabase + Vercel. The global CLAUDE.md's ASP.NET/SQL Server default is for LGU
  internal systems and is the wrong fit here.
- The approved design system is a hard constraint. `web/app/globals.css` is `styles.css` ported
  verbatim, class names unchanged. Admin screens should reuse those tokens and components. **No
  Tailwind, no redesign of the public site while building admin.**
- Plain `<img>`, not `next/image` — the layout depends on `object-fit` in absolutely-positioned
  parents, and `sharp` is deliberately out of the dependency tree.
- Listings are staff-entered. `broker_id` is nullable and unused, so the broker portal stays a later
  additive phase.
- Filtering happens in Postgres via `searchParams`, one query per page load.

---

## Open questions for the owner — ask before building

1. **Sequencing.** Phase 4 needs Supabase Auth wired up, which is Phase 3's job (buyer accounts +
   favourites + the `localStorage` merge). Either do Phase 3 first, or build auth inside Phase 4 and
   have Phase 3 reuse it. Which?
2. **Who gets staff accounts**, and is there a difference between `staff` and `admin` in practice?
3. **How many real listings** exist to migrate? The 12 in there now are the mockup's content.
4. **Are the photos in `assets/` licensed for commercial use?** Still unanswered from Phase 0. The
   site is live and public now, so this matters more than it did.
5. **Draft photos**: private bucket, or accept the exposure? (See above.)

---

## Parked work, carried forward

Nothing here is a blocker for Phase 4, but it is all still open.

**From the Phase 2 logic hunt**
- Sold listings are publicly readable but have no detail page — the "Just sold" rows are deliberately
  not links. Giving them a read-only page fits naturally in Phase 4.
- Favourites and browsing history match against the newest 60 listings only.
- The verify band still shows the mockup's marketing figures (+840 listings, +45 towns) while the
  site lists 12. The owner's call, not a bug.
- No automated tests exist. A `test-me` run would turn "verified by hand" into a real matrix.

**From the 2026-07-29 security audit**
- View counting can still be gamed by discarding cookies between requests. Closing it needs per-address
  rate limiting at the edge.
- `property_requests` accepts anonymous inserts (throttled to 3/hour/email). Add a captcha before
  Phase 5 wires the form up.
- Two Supabase advisor warnings remain **by design**: `top_listings()` anon-callable (the home page
  ranks on it) and `is_staff()` callable by signed-in users (the RLS policies evaluate it as the
  caller). Both pin `search_path`. Do not "fix" these.
- The old static site is still live on GitHub Pages at
  `officialusername111-svg.github.io/dascout/`. Retiring it is Phase 6, and it needs the owner's yes.

---

## How to start

```
/build-me Phase 4 of dascout/docs/BUILD-PLAN.md — staff sign-in, listing create/edit,
photo upload with reordering, and the draft → verifying → live → sold lifecycle with
verification events. Read dascout/docs/PHASE-4-BRIEF.md first; it carries the current
state, the admin bootstrap trap, and the open questions.
```

Answer the open questions above first — question 1 changes the shape of the whole phase.
