# Phase 5 — Requests & notifications · intake brief

Written 2026-07-31 at the end of the Phase 3 session, for whoever starts Phase 5 in a fresh
session. Read this, then `BUILD-PLAN.md` §6 (Phase 5) and the two run records
(`docs/agent-runs/run-p4-admin.md`, `docs/agent-runs/run-p3-accounts.md`). Everything below
was verified against the running system on 2026-07-31.

---

## Before anything: no review gate, but one BLOCKING prerequisite

- No `REVIEW-PENDING.md` exists — run-p3-accounts was reviewed, approved, pushed and
  verified live. Nothing is parked awaiting acknowledgment. Everything is pushed
  (`origin/main` = `f59f21f`).
- **The CSP nonce rework is titled "blocking before Phase 5"** (panel ruling carried through
  both prior runs). `next.config.ts` still ships `script-src 'unsafe-inline'` with a comment
  saying revisit; Phase 5 is the phase where ANONYMOUS-authored content
  (`property_requests` rows) starts reaching staff-rendered pages. Do the nonce work FIRST,
  as its own slice, before any request content renders anywhere.

## What Phase 5 is

From the build plan: *Request form saves and emails your team; buyers get an email when a
matching verified listing goes live. Price changes write to `price_history`, which makes the
market panels real.* Concretely:

1. Wire `RequestDialog` in `components/Dialogs.tsx` (currently validates and says "not
   switched on" — same demo-UI situation the auth modals were in before Phase 3). Saves to
   `property_requests` + notifies the team by email.
2. Match alerts: when a listing goes `live`, buyers whose saved request matches (category /
   town / budget) get one email. Needs a matching rule and a send point (the `→ live`
   transition already has exactly one code path: `transitionListing` in
   `app/admin/actions.ts`).
3. Market panels: verify what is already real. `price_history` has a working trigger (price
   edits write rows — proven in Phase 4 AC-13b) but the table has **0 rows** today, and the
   "Price reduced" panel's data path should be checked against `lib/queries.ts` before
   assuming anything. "Just sold" derives from `status='sold'` and may already be real.
4. Probably an admin surface for requests (list + `is_handled` toggle) — `is_handled`
   exists on the table; scope it small.

## What already exists that you MUST reuse (do not re-derive)

- **Email now actually sends.** Resend SMTP is live for AUTH mail (domain
  `dascoutprime.com` verified, DNS at Hostinger, sender `no-reply@dascoutprime.com`).
  **BUT the app has no Resend API key** — the only key lives inside Supabase's SMTP config,
  which the app cannot use. Phase 5's transactional mail (request notifications, match
  alerts) needs its OWN key: owner creates a second key in Resend → goes into
  `web/.env.local` AND Vercel env as `RESEND_API_KEY` (server-only, never `NEXT_PUBLIC_`).
  This is an owner action to request EARLY. BUILD-PLAN §2 already names Resend for exactly
  this; call their HTTP API directly — no SDK dependency needed unless a concrete need appears.
- `property_requests` table (schema in `lib/database.types.ts`): email, category (nullable
  enum), preferred_town (free text), budget_min/max (numeric, nullable, ≥0 checks), notes,
  is_handled, profile_id (nullable FK). RLS was hardened in
  `supabase/migrations/20260729130410_harden_property_requests.sql` — READ IT before
  touching the table; it defines who may insert what today.
- The whole Phase 3/4 pattern stack: `ActionResult` + `useActionState` forms
  (`.field.invalid .ferr`, `.fmsg`), guards (`lib/admin/auth.ts`, `lib/account/auth.ts`),
  uniform non-enumerating responses, `lib/site.ts` for SITE_URL, zod v4 idioms in
  `app/account/actions.ts` (the closest sibling for a public-facing action), ZZ-prefix test
  protocol, Vitest+Playwright harness (62 + 75 green — extend, never weaken).
- A signed-in buyer's request should attach `profile_id` from the session (same
  insert-time attribution idiom as `recordListingView` in `app/actions.ts`).

## Traps that will bite on day one

1. **The nonce work is not optional and not small.** Every inline `<script>` and
   `dangerouslySetInnerHTML` (JSON-LD in layouts/pages) must carry the nonce; Next 16 has
   its own nonce plumbing — read `web/node_modules/next/dist/docs/` on CSP before starting
   (middleware here is `proxy.ts`, which is where the nonce is minted per-request).
2. **The request form takes an email from ANONYMOUS visitors.** Everything Phase 3 learned
   about enumeration and abuse applies harder here: uniform success response, no echo of
   whether an email is known, server-side caps on every field, and a real answer to "what
   stops a bot from inserting 10,000 rows / triggering 10,000 team emails?" (check what the
   harden migration already throttles; expect to need a per-session/day cap like
   `listing_views` has).
3. **Budget is free text in the UI** ("e.g. ₱2M – ₱6M") but `budget_min`/`budget_max` are
   numeric columns. Parsing pesos shorthand (2M, 6.5M, 500k, ranges with –/to) is a real
   sub-problem — spec it in discovery, don't improvise in the action.
4. **Match alerts can double-send.** `transitionListing` can fire `→ live` more than once
   for the same listing (withdraw → relist is legal). Decide idempotency up front: a
   `notified_at`-style record per (request, listing), or alerts only on FIRST publish.
   Also: the alert email contains listing data — it renders anon-authored request context
   nowhere, but confirm that during the security pass.
5. **Do not send mail synchronously inside the transition action's critical path** without
   a decision: a slow/failed Resend call must never make publishing fail or hang. Fire
   after the flip succeeds; a lost email is a warning, not a rollback.
6. **Vercel + background work:** there is no daemon. Anything not triggerable from a
   user/staff request needs Vercel cron, a Supabase edge function, or a DB webhook — pick
   deliberately in discovery, don't assume one exists.

## Parked items carried forward (do not silently build)

CSP nonce (now due — see above) · sold-listing public detail page · move draft photos back
on withdraw · last-photo rule for sold listings · `storage_path` DB constraint ·
legacy-object write-narrowing · export of the six Phase-0 migrations (note: a future blanket
re-grant is the standing risk the export must not introduce) · durable wire-replay authz
test (AC-4b) · leaked-password protection toggle (owner) · history retention period (owner)
· rotate/delete the two test fixtures (owner) · BD proposals from run-p3: `favorites`
profile_id-only index once real accounts exist; the 1000-favourite ceiling over-counts
(anti-join would fix; harmless today).

## Test fixtures & credentials (state as of 2026-07-31)

- `test-staff-p4@dascout.local` (staff) and `test-buyer-p4@dascout.local` (buyer) in
  production auth; creds only in `web/.env.local`; both verified working at the end of the
  Phase 3 session. The committed suites read them from there.
- DB is at content baseline: 12 listings (live/sold), 0 events, 0 favorites, 0 attributed
  views, 0 `property_requests`, 0 `price_history` rows. All ZZ residue swept.
- Owner's account `ronarddanay@gmail.com` (admin) — never handle its password.
- Run-state files at repo root (`PLAN.md`, `CONTRACT.md`) are gitignored Phase 3 leftovers;
  the next run overwrites them.

## How to start

```
/build-me Phase 5 of dascout/docs/BUILD-PLAN.md — the CSP nonce rework first (it is titled
blocking), then the property request form wired to property_requests with team notification
email, match alerts when a matching listing goes live, and the market panels verified real.
Read dascout/docs/PHASE-5-BRIEF.md first; it carries the Resend-key trap, the
anon-abuse surface, and the double-send question.
```

Ask the owner for the app's `RESEND_API_KEY` early — it gates every email deliverable.
