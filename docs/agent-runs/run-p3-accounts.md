# Run record — run-p3-accounts (Phase 3: buyer accounts)

Write-ahead decision trail per the Autonomy Contract (§0). Pre-run HEAD `65402e2` on `main`;
work on `auto/run-p3-accounts`. Intake: buyer sign-up/sign-in wired into the existing public
modals, favourites + browsing history on the account with a lossless `localStorage` merge, and
password management (change + forgot/reset) for all roles (BUILD-PLAN Phase 3, PHASE-3-BRIEF).
Tier **Large** (auth + PII surface + public-facing + a grant-widening migration).
Terminal state: _in progress_.

**Review gate:** `REVIEW-PENDING.md` (run-p4-admin) was acknowledged by the owner in the
invocation ("phase 4 is approved") and deleted at intake. Gate clear.

## Facts established at intake (probed, not assumed)

Trap #1 in PHASE-3-BRIEF asked for the Supabase Auth dashboard settings as an owner action.
Three of the four were settled empirically against the hosted project instead, by driving
`/auth/v1/signup` with the publishable key. No auth user was created by any probe (all four
attempts were rejected before insert; `auth.users` still holds exactly the 3 known rows).

- **F1 — "Confirm email" is ON.** A signup with a deliverable-looking domain returned
  `429 over_email_send_rate_limit`. GoTrue only attempts an email send on signup when
  confirmations are enabled, so the attempt itself is the proof. Consequence: signup does
  **not** return a session; the buyer must click a link in an email.
- **F2 — the project is on the default Supabase SMTP, and its budget is tiny.** The rate limit
  tripped on the *first* deliverable signup of the session. Default built-in SMTP is a
  couple of emails per hour, project-wide, shared between confirmation and recovery mail.
  Consequence: sign-up confirmation and password reset are **not operable for real buyers**
  until custom SMTP is configured. This is an owner action, not a code defect — see A1.
- **F3 — signup rejects `.local` and `example.com` addresses** (`400 email_address_invalid`).
  The Phase 4 fixtures (`test-*-p4@dascout.local`) exist only because they were SQL-seeded,
  which bypasses this validation. Any fixture that must go through the *public signup path*
  needs a domain that passes GoTrue's validation.
- **F4 — Supabase's own password floor is 6 characters** (`422 weak_password`, reason `length`).
  The approved mockup promises "At least 8 characters", so the app schema enforces 8 — stricter
  than the backend, which is the safe direction.
- **F5 — Site URL and the redirect-URL allowlist are not readable** from the MCP/postgres
  channel (GoTrue config is not in the database). This one stays an owner action.

## Schema facts (read at intake — no re-derivation needed)

- `favorites (profile_id, listing_id)` PK, `favorites_own` RLS `ALL to authenticated` on
  `auth.uid() = profile_id`. **No migration needed.** Note the key is `listing_id`, while
  `localStorage` favourites are keyed by **slug** — the merge has to resolve slug → id.
- `listing_views` has `listing_views_insert_visible` (anon+authenticated INSERT, permits
  `profile_id = auth.uid()`) and `listing_views_staff_read` (SELECT, staff only). **A buyer
  cannot read their own view rows** → browsing history on the account needs an additive
  SELECT policy. Unique index `(listing_id, session_hash, viewed_on)` = one row per listing
  per session per day.
- `profiles`: `profiles_select_own_or_staff`, `profiles_update_own`, `profiles_staff_all`;
  `handle_new_user` copies `raw_user_meta_data->>'full_name'` on signup; `guard_profile_role`
  blocks role self-promotion. No migration needed.

## Decisions (write-ahead — each precedes the work it authorizes)

- **D1** Reuse Phase 4's auth plumbing verbatim (`lib/supabase/{server,client,anon}.ts`,
  `proxy.ts`, the `ActionResult` + `useActionState` pattern, the `cache()`-wrapped guard
  idiom). Buyer guard is a `requireUser()`/`getSessionUser()` variant in a new
  `lib/account/auth.ts` — same idiom, not a second one.
- **D2** Public buyer actions live in a new `app/account/actions.ts`, not in
  `app/admin/actions.ts` — the admin module's every action opens with a staff guard, and
  mixing buyer-callable actions into it invites a guard-by-copy-paste mistake. The
  `ActionResult` type is imported from the admin module (single definition, no fork).
- **D3** Sign-up is built to work **whether or not** email confirmation is on: the action
  inspects whether a session came back. Session → signed in, merge runs immediately. No
  session → "check your email" state. This removes the build's dependency on F1/F5 being
  settled, and stays correct if the owner later flips the setting.
- **D4** The `localStorage` merge is **union both ways**, per brief trap #4: on first
  authenticated load, local slugs resolve to ids and are inserted with
  `upsert(..., { ignoreDuplicates: true })`; then the account's full favourite set is written
  back to `localStorage` so the mirror is complete. Neither side loses a row. The merge is
  idempotent and safe to re-run.
- **D5** Browsing history stays **local-first**. `listing_views` is a view-*counting* table
  (one row per session per day, `profile_id` nullable, rows survive sign-out) — it is the
  analytics ledger, not a per-user reading list, and it can only ever hold live/sold
  listings. The account's history panel reads it for a signed-in buyer (via the new policy)
  and unions it with the local list, same shape as favourites.
- **D6** Password change uses `updateUser({ password })` under the caller's own session and
  **re-authenticates first** by calling `signInWithPassword` with the submitted current
  password — Supabase does not require the old password, so without this a stolen session
  cookie is a silent account takeover. Available to every role at `/account/password`.
- **D7** Password reset is `resetPasswordForEmail({ redirectTo })` → a route handler at
  `/auth/callback` that exchanges the code for a session → `/account/password?reset=1`.
  Cookie writes happen in the route handler (Server-Action/Route-Handler rule).
  The response to a reset request is **uniform whether or not the email is registered**.
- **D8** Migration: one additive migration adding a buyer SELECT policy on `listing_views`
  for own rows. Nothing else. No grant is narrowed.
- **D9** Test fixtures: reuse `test-buyer-p4@dascout.local` for session-level tests (it signs
  in fine; only *signup* is domain-validated). The public-signup path is covered by asserting
  the action's behaviour rather than by minting real accounts against a 2-emails-per-hour
  SMTP budget — see A1/A2 for what that leaves parked.
- **D10** No new dependencies. No new visual direction: the existing modal markup and
  `globals.css` classes are wired, not redesigned (brief trap #5).

## Assumptions and parked slices

- **A1 (`blocked-on-fact`, owner action)** End-to-end email delivery — sign-up confirmation
  click-through and the reset link — cannot be verified from here: F2 means the send budget is
  spent and F5 means the Site URL / allowlist is unreadable. The code paths are built and
  covered; the *delivery* leg is parked. Owner action: configure custom SMTP (Resend is
  already the plan's choice for Phase 5) and confirm Site URL = `https://dascoutprime.com`
  with `/auth/callback` allowlisted.
- **A2** Anything that would mint real auth users through the public signup path is capped by
  F2. Tests assert behaviour at the action/RLS layer instead.

## TL rulings on BA's risk register (write-ahead — these amend the decisions above)

BA returned AC-1..AC-61 plus 7 risks. Five of the risks land on the frozen decisions and are
resolved here before any code is written. Each ruling names what BA found and what changes.

- **R1 → D5 amended (browsing history was going to ship empty).** BA found `app/actions.ts:48`
  never writes `profile_id`, so the buyer SELECT policy alone would return nothing, forever,
  with no error to reveal why — a feature that looks built and is not. `recordListingView` now
  attaches `profile_id` when the caller has a session. The same-day unique index
  `(listing_id, session_hash, viewed_on)` means a visitor who views anonymously and *then*
  signs in collides on re-insert, so the write is an upsert that fills in `profile_id` on the
  existing row rather than a bare insert (BA AC-38).
- **R2 → D4 amended (this one sits inside the phase's named risk).** BA is right that a local
  favourite whose listing has since gone `draft`/`withdrawn` cannot be resolved to an id at
  all: public RLS hides the row, so the buyer's own client cannot even confirm it exists.
  Dropping it would lose a favourite through no act of the user's — precisely the "visible
  betrayal" BUILD-PLAN §7 names. Ruling: **the localStorage write-back is a union, never a
  replacement** — `account slugs ∪ unresolved local slugs`. The account gets what can be
  resolved; the browser keeps everything. If the listing returns to `live`, the next merge
  picks it up. No elevated read path, no new scope, and nothing is lost.
- **R3 → D8 widened, narrowly.** BA found "Clear browsing history" is cosmetic for a signed-in
  buyer: local clears, then the server union repopulates it. A buyer DELETE policy would let
  someone erase rows the "Top Properties" ranking counts. Ruling: clearing **de-attributes
  rather than deletes** — the buyer's own rows have `profile_id` set to null. The view still
  counts, the personal association is gone. That is both the honest ranking answer and the
  better privacy answer. The migration therefore grants own-row SELECT plus an UPDATE whose
  `with_check` permits only `profile_id is null`.
- **R4 → D7 amended (a real hole, not a hypothetical).** Keying the re-auth skip off
  `?reset=1` would let anyone holding a stolen ordinary session cookie set a new password
  without knowing the old one — defeating the whole point of D6. Ruling: `/auth/callback`,
  after a successful code exchange, sets a short-lived HttpOnly cookie marking "this session
  arrived through a verified recovery link" (same idiom as the `ds-vs` view cookie in
  `app/actions.ts`). The change-password action skips re-auth **only** on that cookie, and
  clears it on use. A query string never authorizes anything.
- **R5 → D6 extended.** BA is right that the stated rationale over-claims: re-auth stops an
  attacker *changing* the password, not one already signed in elsewhere. A person changing
  their password defensively believes it locks others out. Ruling: a successful change is
  followed by `signOut({ scope: 'others' })`.
- **R7 → housekeeping.** `lib/database.types.ts` predates `viewed_on`. Types are regenerated
  from the live schema after the migration lands, before BD writes any `listing_views` query.

**Open questions BA escalated, answered by TL (none is an external fact, so none parks):**
1. Withdrawn-listing favourites → retained locally, per R2. 2. Sign-out → the local mirror is
retained, not cleared: it matches exactly what an anonymous visitor already sees today, and the
merge is idempotent so retention is safe. 3. Other sessions → signed out, per R5.
4. **Label copy is corrected**: `#rg-user` is labelled "Username" but captures `full_name`, and
`#li-user` says "Email or username" while only an email can work. Leaving them would be
actively misleading, so the label text changes — text only, no layout or visual change. That is
wiring, not redesign. 5. Clear-history → de-attribution, per R3.

## Panel outcome (3-lens blind panel, merged by TL)

Verdicts: correctness PROCEED-WITH-BINDINGS (CL-1..8) · security/data PROCEED-WITH-BINDINGS
(SL-1..14 + hardening list) · simplicity/scope PROCEED-WITH-BINDINGS (SP-1..11). No HALT, no
parked slice. Two facts verified live during the merge: session JWTs carry `amr`
`[{method, timestamp}]` (probed with the buyer fixture; probe session revoked), and the
drafted `claim_listing_view` migration was deleted **unapplied** — superseded by SL-13.

**Recorded conflicts and TL resolutions:**

- **Sign-out (SP-1 = CL-2 = SL-3, three lenses, two documents).** PLAN said clear; the run
  record's OQ-2 answer said retain. Resolution: **clear the mirrored, keep the yours** —
  sign-out removes `ds-sync`, clears `ds-hist`, and sets `ds-favs := ds-favs ∖ mirrored`
  (`mirrored` from `ds-sync` is the provenance record CL-2 asked for; no new bookkeeping).
  A withdrawn-listing favourite that never reached the account survives sign-out (CL-2);
  the next person on the machine inherits nothing account-derived (SL-3). The OQ-2 answer
  above is superseded. Residual for unclean session end: the userId-keyed marker.
- **Retro-attribution (CL-1 = SL-2, opposite fixes).** CL-1 proposed a definer claim
  function; SL-2 preferred dropping same-day back-fill outright and separately flagged
  `ds-vs` never rotating across the auth boundary (SL-13). Resolution: **SL-13 makes both
  arguments moot** — rotate `ds-vs` on sign-in, sign-up-with-session, sign-out, and
  clear-history. A fresh session hash means post-sign-in views never collide with anonymous
  same-day rows, so attribution at INSERT simply works; the anonymous prefix of the day
  stays unattributed (device history covers display). R1's upsert wording is amended to
  insert-time attribution + rotation. No new definer function ships (smaller surface, SP
  direction). The forbidden-repair line stands: `listing_views_own_detach` and the column
  grant are never widened.
- **Reset gate (SL-1 kills the `ds-pwreset` design).** The cookie was mintable
  (attacker's own recovery + victim's stolen session cookies = takeover). Resolution:
  **no marker cookie at all.** Recovery-ness is derived server-side from the session's own
  `amr` claim — verified present — requiring method `otp`/`recovery`/`magiclink` with a
  timestamp ≤ 15 min old, checked in BOTH the page (which form renders) and the
  `resetPassword` action. The claim is Supabase-signed and lives in the same token as the
  identity, so it cannot be transplanted between sessions. CL-6's expiry dead-end gets a
  distinct "link expired — request a new one" message. `?reset=1` remains pure UI sugar.
- **Uniform responses (SL-5 reverses SA-A3).** GoTrue's per-address 60s cooldown returns
  the same error code as the project-wide budget and only fires for addresses that exist —
  any honest rate-limit sentence on reset or signup is a one-bit-per-address oracle.
  Resolution: `requestPasswordReset` and `signUpBuyer` return their uniform sentence for
  EVERY outcome including rate limits; error codes go to server logs (codes only, never the
  address — SL-9). The honest `RATE_LIMITED` sentence survives only on authenticated
  surfaces (change-password re-auth). SA-A3 is reversed.
- **Email templates (CL-3 vs SL-4).** token_hash links are bearer credentials (SL-4 forced
  login), but the PKCE `?code=` shape is same-browser-only (CL-3/R3). Resolution: the
  callback accepts `token_hash` for `type=recovery` ONLY; A1's owner actions gain "switch
  the RECOVERY email template to the token_hash form" (fixes cross-device reset, the
  likeliest real failure). The confirmation template stays default; cross-device
  confirmation is handled by CL-4's distinct missing-verifier copy ("opened in a different
  browser — your email may already be confirmed; sign in with your password").
- **Caps (SP-4 vs CL-8).** FAV_CAP is neither a product cap nor a merge truncation: the
  toggle stays unbounded as today (SP), the merge never truncates (CL), and abuse is bounded
  server-side — per-request payload `.max(200)` + raw-size guard (SL-7) and a 1000-row
  per-account ceiling checked count-first in `setFavorite` and the merge (refuse whole,
  keep local, plain message — lossless locally even in refusal).

**Adopted without conflict:** CL-4 (missing-verifier copy + test) · CL-5 (reset also
`signOut({scope:'others'})`) · CL-7 (marker is userId-keyed; on mismatch discard stale
mirrored entries before merging; write-back replaces the mirror) · SL-11 (on marker-match
mounts AccountSync refreshes read-only from the account — server removals propagate to the
mirror, uploads happen only on first merge per device per account) · SL-6 (proxy returns
early for `/auth/*`; exactly one cookie writer on the callback request) · SL-8 (probe client
per-call, `persistSession:false`, revoked `scope:'local'` in `finally`; bare `signOut()`
defaults to GLOBAL and would kill the caller's own session) · SL-9 (password fields never in
`values` — asserted by unit test; log codes never addresses) · SL-10 (`Cache-Control:
no-store` on callback; never log the callback URL; packet note on token-in-logs) · SL-12
(privacy line on the history screen + register form: signed-in views are saved to the
account and visible to staff; retention period = owner question in packet; history reads
name columns, never `session_hash`) · SL-14 (`describeSignUpOutcome` pure mapper +
byte-identical fixture tests) · SL hardening list (tight `safeNext`, `redirectTo` from the
compile-time constant only, `no-store` on `/account/*`, full_name control-char guard, CSRF
posture noted not claimed, throttle residual restated as widened) · SP-2 (fast path CUT —
`AccountSync` is the only merge trigger) · SP-3 (overview page = identity + sign-out home +
links; header carries just the Account link) · SP-8 (staff nav link to `/account/password`
in `app/admin/(staff)/layout.tsx`) · SP-9 (importers move to `lib/site.ts`; no permanent
re-export) · SP-5/6/7/10/11 (keeps confirmed as ruled).

**Packet notes from the panel:** migrations 060000/060100 were applied before the panel
convened — additive and panel-reviewed sound, but the sequencing habit is named and will not
be repeated on anything non-additive · Phase-0 grants are untracked, so a future blanket
re-grant would silently undo the column grant — the BT column-grant test is the tripwire ·
`revoke update` covers staff too (harmless now; named for whoever adds a staff UPDATE policy)
· view counts remain forgeable via direct PostgREST INSERT (pre-existing, out of scope) ·
owner questions: history retention period; recovery-template switch; SMTP/Site URL/allowlist
as already parked.

## Verification summary (BT) and terminal state

**BT outcome: GREEN.** 62 Vitest (10 files) + 75 Playwright (11 specs) executed and passed;
the 33 + 48 pre-existing Phase 4 tests untouched and green in the same full-suite runs. Zero
product defects found. Coverage: the 32-row acceptance matrix — signup outcome byte-identity
and schema boundaries, uniform sign-in denials, staff-through-the-public-door plus the
Phase 4 admin-door regression, favourites RLS both directions, the merge journeys (union,
idempotency, server-removal propagation, sign-out subtraction, cross-account isolation on a
shared browser, double-toggle), history attribution/read/clear via the RPC, the dead direct
UPDATE surface, password change with fixture restoration, reset-bypass refusal, callback
failure paths + next sanitization, and the noindex/no-store/robots/sitemap hygiene rows.
BT disclosed one test-side incident: its first password spec left the live buyer fixture
rotated when a timeout skipped the in-page restore; BT recovered the value from the
Playwright trace, restored it, redesigned restoration into a page-independent `afterAll`,
and verified the fixture three times after. No product impact.

**Parked (recorded, not failed):** the email-delivery leg (A1 — SMTP budget spent, Site URL
/ allowlist unreadable, no service-role key to mint links), therefore `hasRecentRecovery`'s
true path and the callback success-path `safeNext` application; and the action-level raw-POST
variant of the reset-bypass check (page-level proven; the action's independent gate confirmed
by inspection).

**Sweep:** all 37 ZZ test listings and their dependents removed via the postgres channel
(98 events, 10 photo rows, 24 views, 1 price-history, 2 feature links) plus 3 orphaned
storage objects deleted through the Storage API as the staff fixture. DB verified at content
baseline: 12 listings all live/sold, 0 events, 0 favorites, 0 attributed views, 0 draft
objects. Advisors: only the known-intentional definer functions plus one new owner item —
leaked-password protection is OFF (dashboard toggle; noted in the packet).

**GREEN gate:** executed tests pass · test-integrity clean (pre-existing suites untouched,
re-run green) · no protected paths in the commit set (the push stays parked) · no staged
secrets (`.env.local` untracked throughout). **Terminal state: done-green**, 2026-07-30
~16:20 +08. Commits on `auto/run-p3-accounts`: 50238ec (data layer), 8078f31 (panel
record), e5739a6 (build), cab1759 (tests), + this record.

**Owner actions carried out of the run (the packet's ask list):**
1. Custom SMTP (Resend is already Phase 5's choice) — until then, confirmation and reset
   emails effectively do not send (F2).
2. Supabase dashboard: Site URL = https://dascoutprime.com; add
   `https://dascoutprime.com/auth/callback` (and localhost for dev) to the redirect
   allowlist (F5/SL-R2 — misconfiguration fails silently).
3. Switch the RECOVERY email template to the token_hash form (CL-3) so reset links work
   across devices; leave the confirmation template default.
4. Consider enabling leaked-password protection (advisor; may require a paid plan).
5. Decide the retention period for account-attributed browsing history (SL-12).
6. Rotate/delete the two test fixture accounts when this run is reviewed (unchanged ask
   from Phase 4; the committed suite reads them from `web/.env.local`).

## Post-deploy closure of parked item A1 (2026-07-31)

The owner completed the four dashboard actions: Resend domain verified (DNS at Hostinger —
DKIM/SPF/MX/DMARC records confirmed correct in-panel), custom SMTP connected, email rate
limit raised, Site URL + `/auth/callback` allowlisted, recovery template switched to the
token_hash form. Live end-to-end proof, owner-participating: `POST /auth/v1/recover` for the
owner's address returned 200 (`recovery_sent_at` stamped, verified by SQL); the email
arrived in Gmail; the link traversed `/auth/callback` → recovery exchange → the amr-gated
two-field reset form rendered at `/account/password?reset=1` on dascoutprime.com. That
closes `hasRecentRecovery`'s true path and the callback success path — the only legs BT had
to park. Remaining owner items (unchanged): leaked-password protection, history-retention
decision, fixture rotation.
