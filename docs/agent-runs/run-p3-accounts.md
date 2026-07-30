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
