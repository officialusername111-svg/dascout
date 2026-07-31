# run-p5-requests — Phase 5: requests & notifications

Run 2026-07-31, autonomous (§0). Pre-run HEAD `b546bdd`; tier Large; 6 dispatches of a
12 budget (3-lens panel, BD-1, BD-2, BT). Terminal state: **done-green**. All 20 acceptance
criteria pass or are explicitly partial-with-evidence (AC-14 numeric caps by code review;
AC-15 live-content assertion skips without Resend headroom).

## What shipped

1. **CSP nonce rework (blocking prerequisite, shipped first).** CSP moved wholly into
   `web/proxy.ts`: per-request nonce on both the request (`x-nonce` + CSP, which Next parses
   to stamp scripts during SSR) and the response; `script-src 'self' 'nonce-…'
   'strict-dynamic'`; `'unsafe-inline'` gone from script-src (kept for style-src — inline
   style attributes, documented). Inbound `x-nonce`/CSP spoofing overwritten. `/auth/` keeps
   the single-cookie-writer rule and now still carries CSP. All HTML routes remain dynamic;
   matcher deliberately keeps prefetches (session-refresh reasoning in the code).
2. **Property request form live** (`submitPropertyRequest` in `web/app/actions.ts`,
   RequestDialog on `useActionState`). Peso-shorthand budget parser `web/lib/budget.ts`
   (single bare value = ceiling; min>max = field error, no swap). `profile_id` attributed at
   insert. Uniform non-enumerating responses: DB throttle trips (3/hour/email, 30/hour
   global — migration below) return the same success shape as a clean insert, logged
   server-side without addresses. Team notification via `after()` + Resend HTTP API
   (`web/lib/email.ts`), text-only, static subject; skips-and-warns when `RESEND_API_KEY`
   or `REQUEST_NOTIFY_TO` is unset. Anon insert must NOT chain `.select()` — no anon SELECT
   policy; noted in code.
3. **Match alerts** (`web/lib/match-alerts.ts`, fired via `after()` from
   `transitionListing` on a successful `→ live` flip only). Match rule: unhandled + ≤180
   days old + category null-or-equal + price within budget bounds + town fuzzy
   (name/province substring, blank = wildcard). Sent-ledger `request_match_alerts`
   ((request,listing) PK): insert-then-send, `sent_at` set only on success, so failed sends
   retry on the next publish and relist never double-sends. Caps: 20 sends/publish
   (deferred logged), 10 lifetime alerts/request. Email is listing-data-only + unsubscribe
   link; no request-authored content. A Resend failure can never fail or hang publishing.
4. **Unsubscribe** `/requests/unsubscribe?token=<request uuid>`: GET renders only
   (mail-scanner safe), POST calls definer RPC `unsubscribe_property_request` → sets
   `is_handled`; identical confirmation for any token (no probing).
5. **Admin queue** `/admin/requests`: staff-guarded list (open first, newest first), all
   user-authored fields as plain text nodes, `is_handled` toggle, alerts-sent count.
6. **Market panels made honest:** fixed `getMarketMovements` — a listing is "reduced" only
   if its most recent price change is a drop (previously a drop followed by a re-raise
   still showed at the stale figures). Trigger + anon-read + panel math proven live with a
   ZZ fixture (created, exercised, withdrawn; withdrawn listings' history is anon-unreadable).
7. **Migration** `20260731070000_phase5_requests_notifications.sql` (additive; applied to
   the live project during the run): global 30/hour breaker in the throttle function,
   `request_match_alerts` + staff RLS + listing index, unsubscribe RPC. Types regenerated
   (web/lib + supabase/types). Advisors clean vs baseline (the one new WARN is the
   intentionally anon-callable unsubscribe RPC).

## Verification

Vitest 136/136 (62 baseline + 50 BD budget + 24 BT). Playwright effectively 100/100: 96
passed in the full run; the 1 failure is the pre-existing `04-sold-path` AC-28a flake
(passed twice in isolation); 1 designed skip (AC-15 live-content, needs Resend headroom).
New durable specs: 12-csp-nonce, 13-request-form, 14-match-alerts-and-panels,
15-admin-requests, 16-unsubscribe; unit suites for budget, email, match predicates. No
pre-existing test modified beyond an additive helper. Zero ZZ residue (verified in
property_requests, request_match_alerts, and public-readable price_history).

## Panel & notable rulings

3-lens blind panel (automated, advisory): all PROCEED-WITH-CHANGES. Key rulings: dropped
the planned per-session cap + `session_hash` column (redundant with email+global caps;
avoided an email↔browsing-history correlation); sent-ledger `sent_at` semantics for retry;
send cap 20; lifetime cap + unsubscribe against alert-bombing; parser grammar trimmed;
uniform success on throttle. Full trail in the run's PLAN.md (gitignored, superseded by
this record).

## Facts discovered / corrections

- **F1: `RESEND_API_KEY` IS present in `web/.env.local`** (the Phase-5 brief said the app
  had no key; intake greps miss gitignored files). `REQUEST_NOTIFY_TO` is NOT set. Resend
  probes during BT showed very low remaining quota headers and intermittent 422s on the
  sandbox address. Owner question below.
- F2: `property_requests` RLS policies exist only on the hosted project — they are not in
  `supabase/migrations/` (part of the known Phase-0 export gap). A rebuild from migrations
  would come up without them.
- F3: listings that ever went live cannot be hard-deleted (`verification_events` RESTRICT
  + no staff DELETE grant); the standing fixture protocol is withdraw-not-delete.
- F4: two elements share the accessible name "Request a Property" (hero CTA + request
  band) — assistive-tech nit, not a defect.

## Owner actions (parked, blocked-on-fact)

- **P1: Set `REQUEST_NOTIFY_TO`** (team inbox) in `web/.env.local` AND Vercel, or team
  notification emails never send. Which address? (`hello@dascout.ph` in the dialog copy is
  on a domain not controlled — the copy may need changing too.)
- **P2: Confirm the Resend key posture.** Is the `.env.local` key also in Vercel? If yes,
  match alerts go live on the next production publish. Check the account's quota/plan (BT
  saw single-digit remaining quota headers). Decide: keep as-is, or rotate to a dedicated
  key.
- **P3: Double opt-in?** Anyone can submit a request with someone else's email; alerts are
  bounded (10 lifetime, unsubscribe link) but the address is never verified. Decide whether
  a confirmation email must precede alerts (would be a follow-up run).

## Carried-forward proposals (not built)

Edge/IP rate limiting (Vercel WAF) for the anon write surfaces · CSP reporting endpoint ·
style-src nonce follow-up (needs inline-style refactor) · extract match predicates to a
pure module for unit testing · integration test for the anon-insert `.select()` trap ·
paging + `(is_handled, created_at)` index on /admin/requests · migration export of the
Phase-0 RLS policies (F2) · pre-existing 04-sold-path flake hardening · the standing parked
items from PHASE-5-BRIEF §"Parked items carried forward".
