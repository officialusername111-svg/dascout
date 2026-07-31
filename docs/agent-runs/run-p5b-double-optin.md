# run-p5b-double-optin — double opt-in for match alerts

Run 2026-07-31 evening, autonomous (§0). Pre-run HEAD `dc9e602`; tier Medium
(PII/email surface → 3-lens panel); 4 dispatches (panel ×3, BT). Terminal state:
**done-green**. Closes run-p5-requests **P3** by owner decision: a property request's
email must be confirmed by its owner before any match alert is sent.

## What shipped

1. **Migration `20260731150000_request_email_confirmation.sql`** (additive; applied to
   the live project mid-run with explicit owner approval at the permission gate):
   `property_requests.confirmed_at` (NULL = unconfirmed; table was empty, nothing
   grandfathered); public insert policy narrowed with `confirmed_at is null` (staff
   path untouched); throttle grows two 180-day caps — ≥3 unconfirmed rows per email
   (a bombing victim gets at most 3 confirmation emails, ever) and ≥5 open rows per
   email — both mapped to the uniform visitor sentence via new `THROTTLE_MARKERS`;
   `confirm_property_request(uuid)` definer RPC mirroring unsubscribe (void,
   idempotent, empty search_path, revoke-public-then-grant anon+authenticated,
   180-day token window matching alert candidacy).
2. **Submit action**: request uuid generated server-side (the anon insert cannot
   `.select()` its own row back) and used as the confirm token; requester
   confirmation email (static subject, fixed copy + link only) sent first inside
   `after()`, deliberately independent of the `REQUEST_NOTIFY_TO` guard so an unset
   team inbox cannot silently disable opt-in. Success copy now instructs to check
   email and retains the substring the 13-spec asserts.
3. **`/requests/confirm`**: literal mirror of `/requests/unsubscribe` (panel ruling:
   duplicate, do not abstract) — GET renders only and identically for every token,
   POST confirms via the RPC and redirects to `?done=1` so the token leaves the
   address bar, identical outcome for valid/wrong/garbage/absent tokens.
4. **Alert gating**: candidate query requires `confirmed_at not null`. The planned
   retry-side gate was cut as unreachable (panel R5). Bonus real fix (panel R10): the
   retry loop now skips rows whose request became `is_handled` — closing the
   pre-existing confirm → publish → failed send → unsubscribe → republish leak.
5. **Types**: hand-added in the build commit so tsc/vitest ran pre-apply; post-apply
   regeneration matched with zero drift (both copies synced).

## Security rulings

3-lens blind panel (advisory): all PROCEED-WITH-CHANGES; amendments R1–R12 in the
run's PLAN.md (gitignored, superseded by this record). The load-bearing one, R1: the
uuid-as-token design cannot give cryptographic consent — a direct PostgREST caller
(public anon key) can insert a chosen id and self-confirm it, because the server
action and a direct API caller share the anon role and this app deliberately carries
no service-role credential (`web/.env.example` forbids it). Every airtight fix
requires exactly such a credential. Accepted residual, recorded in the migration
comment: that attacker gains only what every submitter had before this feature,
now bounded tighter by the new caps, with an unsubscribe link in every alert. The
browser flow — the product path — is genuinely double opt-in. Advisors: exactly one
new WARN, the intentionally anon-callable confirm RPC (same class as unsubscribe).

## Verification (BT, independent)

Vitest 136/136. Playwright 26/26 across suites 13–17: 13-request-form unchanged and
passing against the new copy; 14-match-alerts fixtures gained `confirmed_at`
(test-data update forced by the schema, labeled as such) plus a fifth deliberately
unconfirmed fixture asserted to receive NO ledger row (AC-2's negative case);
15-admin and 16-unsubscribe untouched and passing; new 17-confirm-request mirrors 16
(GET no-mutate, POST confirms, idempotent second POST preserves the original
timestamp, bogus/garbage/absent tokens uniform). Zero fixture residue verified in
property_requests and request_match_alerts. No implementation file touched by BT; no
pre-existing assertion weakened.

## Facts discovered

- **F1: Playwright's webServer serves whatever is already in `.next`** (`npm run
  start`, no rebuild by design). BT's first run false-failed 7 tests against a stale
  build until it ran `npm run build`. Open decision: keep the by-hand convention or
  make the config rebuild — see proposals.
- F2: one transient Vitest failure ("JWT issued at future", clock skew) in
  anon-rls-reads on first run; clean 136/136 on immediate rerun.

## Owner actions (parked)

- None new. Still standing from run-p5-requests: the `hello@dascout.ph` uncontrolled
  domain in dialog copy; replace `REQUEST_NOTIFY_TO=ronarddanay@gmail.com` when a
  team inbox exists.

## Carried-forward proposals (not built)

Service-role-credential token hardening (upgrade the accepted R1 residual to
cryptographic consent) · make `playwright.config.ts` rebuild before `start` (or add a
CI guard on `.next/BUILD_ID` staleness) · confirmation-email resend affordance if
users lose the mail (currently: resubmit, capped at 3 unconfirmed) · the standing
items in run-p5-requests §Carried-forward.
