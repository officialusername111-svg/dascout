# Phase 3 — Buyer accounts · intake brief

Written 2026-07-30 at the end of the Phase 4 session, for whoever starts Phase 3 in a fresh
session. Read this, then `BUILD-PLAN.md` §6 (Phase 3) and `docs/agent-runs/run-p4-admin.md`
(what Phase 4 left you). Everything below was verified against the running system.

---

## Before anything: the review gate

Phase 4 ended `done-green` but its review marker may still be unacknowledged. If
`REVIEW-PENDING.md` exists at the repo root, **no new autonomous run may start** until the owner
says "reviewed run-p4-admin" (or deletes the marker themselves). Check first.

## What Phase 3 is

From the build plan: *Supabase Auth wired into the existing sign-in and register modals,
favourites and browsing history moved to the account, `localStorage` merged in on first sign-in
so nobody loses saved properties.* The owner has additionally asked for a **change-password
screen** — it was the first thing they looked for after Phase 4 and it isn't there. Build it in
this phase, and make it work for staff/admin too (they currently have no way to change a password
inside the app).

## Where the project actually is

| | State |
|---|---|
| Phases 0–2 | Done; public site live at https://dascoutprime.com |
| Phase 4 — admin & verification | **Done first** (sequencing decision A1: auth was built in Phase 4; Phase 3 reuses it). Merged `67c88ad`, deployed 2026-07-30 |
| Phase 3 — buyer accounts | Not started. This brief |
| Real accounts | The owner (`ronarddanay@gmail.com`, role `admin`) + two test fixtures (below). No buyers yet |

- Repo root `D:\Workspace\DaScout\dascout` (git root is this folder). App in `web/`,
  Next.js 16.2.12 — **read `web/node_modules/next/dist/docs/` before writing Next code**;
  middleware is `proxy.ts` here; `cookies()` writes only in Server Actions/Route Handlers.
- Hosted Supabase `kogpuuidawbmttyswvsx` is production — the live site reads it. Migrations are
  applied via MCP and also committed to `supabase/migrations/`. Additive-only, always.

## What Phase 4 built that you MUST reuse (do not re-derive)

- **Auth plumbing works end to end**: `lib/supabase/{server,client,anon}.ts`, `proxy.ts` session
  refresh, cookie sessions. `signIn`/`signOut` server actions exist in `web/app/admin/actions.ts`
  — the buyer flow needs its own actions but should copy their shape.
- **The guard pattern**: `lib/admin/auth.ts` (`checkStaff`/`requireStaff`, `cache()`-wrapped,
  `getUser()` + own-row profile read). Buyer pages needing a session should follow the same
  pattern with a `requireUser()` variant — do not invent a second idiom.
- **`ActionResult` + `useActionState` form pattern** (`app/admin/actions.ts`, any
  `components/admin/*Form.tsx`): field-keyed errors into `.field.invalid .ferr`, banners via
  `.fmsg`. The public dialogs must use the same result shape.
- **Test harness exists**: `npm run test` (Vitest, real-session integration) and `npm run
  test:e2e` (Playwright vs `next build && next start`). Extend it; the GREEN gate needs executed
  tests. Fixtures: `TEST_STAFF_EMAIL`/`TEST_BUYER_EMAIL` (+ passwords) in `web/.env.local`.
- **DB already has**: `profiles` auto-created on signup by `handle_new_user` (role `buyer`);
  `favorites` table with `favorites_own` RLS (authenticated, own rows only);
  `listing_views.profile_id` nullable FK for attributing views; `profiles_guard_role` blocks
  role self-promotion. None of this needs migrations.

## Traps that will bite on day one

1. **Supabase Auth settings are unverified for public flows.** Phase 4 only ever used
   password sign-in with SQL-seeded, pre-confirmed users. Before building sign-UP: check in the
   dashboard (owner action or ask them to read it back): Site URL (must be
   `https://dascoutprime.com`), redirect-URL allowlist, whether "confirm email" is on, and the
   auth rate limits (also still owed from the Phase 4 packet). Sign-up confirmation emails and
   password-reset emails link back to the Site URL — if it's wrong or the catching route doesn't
   exist, both flows dead-end.
2. **Password reset/change needs app routes that don't exist**: a "forgot password" flow
   (`resetPasswordForEmail` → email → a route that catches the token and calls
   `updateUser({ password })`) and a signed-in change-password form (`updateUser` directly).
   Cookie writes only in Server Actions — the reset-catch page must follow the Phase 4 idiom.
3. **A buyer signing in at `/admin/sign-in` is signed straight back out by design** (Phase 4
   decision SA-2). The public modals are the buyer door. Don't "fix" the admin door.
4. **The localStorage merge is the phase's named risk** (BUILD-PLAN §7): favourites live in
   `localStorage` today (see `components/FavButton.tsx`, `components/Dialogs.tsx`); merging on
   first sign-in must not lose or duplicate them. Merge = union, server wins on conflicts is
   wrong here — union both ways, then localStorage mirrors the account.
5. **The existing modals are demo UI** (`components/Dialogs.tsx` validates and shrugs). Wire
   them; do not redesign them. No new visual direction — same rule as Phase 4 (globals.css
   verbatim, no Tailwind).
6. **CSP is fine for auth** (`connect-src` already allows the Supabase origin) but the parked
   nonce work is titled **blocking before Phase 5** — anon-authored `property_requests` content
   must not reach rendered pages before it lands. Phase 3 doesn't trigger it; don't let scope
   creep into it either.

## Parked items carried forward (do not silently build; full list in run-p4-admin.md)

CSP nonce rework (blocking before Phase 5) · sign-in throttling (residual control: Supabase
default rate limits) · sold-listing public detail page · move draft photos back on withdraw ·
last-photo rule for sold listings · `storage_path` DB constraint · legacy-object write-narrowing ·
export of the six Phase-0 migrations · durable wire-replay authz test (AC-4b). Owner questions
still open: who gets real staff accounts · real listing count to migrate · `assets/` photo
licensing.

## Test fixtures & credentials (state as of 2026-07-30)

- `test-staff-p4@dascout.local` (staff) and `test-buyer-p4@dascout.local` (buyer) exist in
  production auth; passwords rotated 2026-07-30, live only in `web/.env.local`. The committed
  suite reads them from there. Keep them; extend fixtures the same way if Phase 3 needs more.
- The owner's account exists (`admin`). Never handle its password; password changes go through
  the dashboard or the change-password screen this phase builds.

## How to start

```
/build-me Phase 3 of dascout/docs/BUILD-PLAN.md — buyer sign-up/sign-in wired into the existing
modals, favourites and browsing history on the account with a lossless localStorage merge, and
password management (change + forgot/reset) for all roles. Read dascout/docs/PHASE-3-BRIEF.md
first; it carries the reuse map, the auth-settings trap, and the review-gate check.
```

Answer trap #1 (auth dashboard settings) early — it shapes the sign-up and reset flows.
