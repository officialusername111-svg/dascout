# run-p7-invite-autoredeem — TERMINAL `done-parked`, nothing built

**Date:** 2026-08-02 · **Pre-run HEAD:** `d3273a0` · **Dispatches:** 2 of 40 · **Tier:** Medium

Paths below are repo-relative; prefix with `dascout/` from the workspace root.

## What was asked

Make an admin invitation complete itself: invite → create account → confirm email → sign in →
already a listing admin, with no second trip to the inbox.

## What was proposed, and rejected

The owner approved a design in which redemption **dropped the token** and instead matched a pending
invite against the caller's **confirmed email**, firing after a successful sign-in.

An independent security review (deliberately given the facts and the design but **not** the
orchestrator's rationale) broke it repeatedly. The design was **not built**. Nothing was committed.
A complete 290-line migration the builder had written before being stopped was moved out of the
repo, not into it.

## The framing error at the root of it

"It fires after a successful sign-in" describes **the app's call site, not the security boundary.**

Nothing reachable from the internet may write `profiles.role` — the column grants at
`20260802021757_admin_invites_and_super_admin_split.sql:264-265` and the guard trigger at `:330-374`
see to that. So the logic must be a `SECURITY DEFINER` function granted to `authenticated`, which is
a public PostgREST endpoint. The real predicate is therefore:

> **any valid session on the invited account, at any moment in the 7-day window, from anywhere,
> including `curl` with the publishable key.**

Every finding below follows from that one correction.

## Findings

### F1 — BLOCKER (new) · a borrowed session becomes `staff` in one call

Any session on the invited account — shared workstation left signed in, handed-down phone, stolen
cookie — converts to `staff` with no password, no mailbox, no token, no prompt. Today the same
session buys only a buyer account.

The codebase already refuses this bar elsewhere: `changePassword` builds a throwaway
re-authentication probe *specifically* because a stolen session is a silent takeover
(`web/app/account/actions.ts:618-632`). The design would gate an admin promotion more weakly than
the password field.

**Closes it:** require a fresh authentication event, not merely a session. `hasRecentRecovery`
(`web/lib/account/auth.ts:118-141`) is the existing machinery.

### F2 — BLOCKER (new) · promotion with no act of acceptance, and an audit row that lies

A mistyped invite address silently promotes whoever holds that account on their next ordinary login.
They clicked nothing. Today this is inert — the invite email states plainly that nothing changes
until it is accepted (`web/lib/admin/invites.ts:179-181`).

**There is no cancel — and this gap is real TODAY.** `admin_invites` has exactly two mutation doors,
`create_admin_invite` and `redeem_admin_invite`. No revoke RPC, no UI. The supersede step
(`20260802021757...sql:418-423`) kills a pending row only by minting a fresh live invite. Inside the
7-day window the owner's only remedy is hand-written SQL.

**And the audit trail would assert a consent that never happened.** `admin_role_changes.via` is
CHECK-constrained to two values (`20260802131500_property_number_and_role_audit.sql:119`) and the
redemption insert writes `actor_id = target_id, via = 'invite_redeemed'` (`:263-264`). An
implementer either reuses that value — a statutory record claiming deliberate acceptance — or omits
the audit insert and reopens the hole that migration exists to close.

### F3 — HIGH (new) · a password reset resurrects a deliberately discarded invite

Momentary read access to a reassigned, forwarding, shared or archived mailbox is enough: request a
reset (`web/app/account/actions.ts:595`), set a password, get promoted. The token path needs the
invite email to still exist in that mailbox; a careful invitee deletes it, exactly as the email
invites them to (`web/lib/admin/invites.ts:179`), while the pending row lives another seven days.

Worse if hooked at `/auth/callback`, which turns both `exchangeCodeForSession` and
`verifyOtp({type:'recovery'})` into a session (`web/app/auth/callback/route.ts:131-134`).

### F4 — HIGH (amplified) · `email_confirmed_at` is a mutable scalar, not mailbox proof

Ways it becomes non-null: the invitee clicked; **`mailer_autoconfirm = true`**; admin API /
Studio "Auto Confirm User"; `admin.updateUserById` with `email_confirm: true`; **any OAuth / OIDC /
SAML identity** (populated from the provider, sometimes regardless of a verified flag);
`linkIdentity`; direct SQL.

**The amplification that matters:** today, switching "Confirm email" off degrades the invite to a
single-factor bearer token — the attacker still needs the emailed secret
(`20260802021757...sql:524-531`). Under the rejected design it degrades to **nothing**: type the
invited address, choose a password, receive `staff`. A dashboard checkbox, changeable with no code
review and no migration, becomes the only wall.

Also: `auth.users.email` is mutable and **nothing in the schema enforces that `email_confirmed_at`
attests to its current value** — that is a GoTrue implementation property, not a constraint.
Providers are enabled at project level, not in code, so "no social login" is an environment
assumption, not a property of this repo.

### F5 — HIGH (new) · "created but not emailed" stops being a safe state

`INVITE_NOT_EMAILED` (`web/lib/admin/invites.ts:243-257`) reasons that an unsent invite is harmless
because *"an unheld secret cannot be redeemed."* Under the rejected design there is no secret to
hold: the row is a live grant for seven days regardless. The owner's screen would say "nothing has
been granted" while the next login grants it.

### F6 — MEDIUM (new) · atomicity

Two PostgREST calls leave a window where the invite is `accepted` and the role unchanged —
permanently, since single-use plus no-cancel means no reissue exists. The current function uses an
upsert *specifically* as a belt for a missing profile row (`20260802021757...sql:597-603`).

### F7 — MEDIUM (new) · `pending` is not `live`

An expired invite stays `status = 'pending'` forever — there is no sweeper
(`20260802021757...sql:183-185`). The token path is safe because `expires_at > now()` sits in its
WHERE. An implementer who trusts the status name turns every invite ever issued into a permanent
standing grant, and **no test in the repo would catch it.**

## What the review could NOT break

- **Double claim / race** — one `UPDATE` with `status='pending'` in the WHERE; READ COMMITTED plus
  the partial unique index (`:186-188`) make replay impossible.
- **Demoting or interfering with a super admin** — `granted_role` CHECK-pinned to `staff`
  (`:157-158`) and `where p.role <> 'admin'` (`:259`). Holds as long as that CHECK stays.
- **Enumeration** — you need the password or the mailbox before the path runs at all. Stays clean
  *provided* nobody adds distinguishable failure reasons "so the UI can explain."
- **Revoked-invite reuse** — excluded by `status`; the shape CHECKs (`:169-170`) keep status and
  timestamps consistent.

## Unverifiable from code alone (stated as assumptions)

1. Live project auth settings: `mailer_autoconfirm`, `mailer_secure_email_change_enabled`, and
   whether any OAuth/OIDC/SAML provider is enabled. **F4 items 2 and 5 are conditional on these.**
   Orchestrator note: "Confirm email" was verified **ON** on 2026-08-02 by behavioural evidence (a
   real self-signup shows `confirmation_sent_at` 45 ms after `created_at`, `email_confirmed_at` 17 s
   later). It is not SQL-readable; there is no config table in the `auth` schema.
2. GoTrue version — determines email-change semantics and which providers hardcode a verified flag.
3. Supabase exempts SSO users from the `auth.users` email uniqueness index. If SAML is ever enabled,
   two rows can share an address and the invited email stops identifying one person.

## Carried forward

- **The cancel gap (F2) is real today** and independent of any flow change. An invite sent to a
  wrong address cannot be recalled for seven days without hand-written SQL. Proposed, not built.
- The successor run is **`run-p8-invite-carry-token`**: keep the token, extend the cookie to the
  invitation's own 7-day life, continue the acceptance automatically after sign-in. Same user-facing
  flow, no change to the threat model, no new database function.
