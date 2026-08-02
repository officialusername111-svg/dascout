# run-p6-admin-invites — super-admin invite + the admin/staff privilege split

- **Run ID:** `run-p6-admin-invites`
- **Date:** 2026-08-02
- **Pre-run HEAD:** `8b78512` on `main`
- **Tier:** Large, security-sensitive (privilege escalation)
- **Route:** `do-me` → `build-me` (backend-led, forms-only admin UI)
- **Terminal state:** `done-green` — migration applied to production 2026-08-02 with the owner's
  explicit approval, verified post-apply, and the escalation-denial proof **executed and passing**.
  Merged to `main` as `50f3198`. Push parked. One security precondition still unconfirmed (see Parked).

---

## What this run found before it built anything

The brief said the privilege split did not exist. It was worse than that: **the split's absence was a
live privilege-escalation hole**, and there were **two** routes through it, not one.

**Route 1 (known from the brief).** `is_staff()` is true for both `staff` and `admin`;
`guard_profile_role()` gates role changes on `is_staff()`; `profiles_staff_all` is
`for all to authenticated using (is_staff())`. So a signed-in `staff` user could `PATCH` their own
`profiles` row to `role='admin'` — one HTTP request, no exploit required.

**Route 2 (found by SA during this run; nobody had it).** `profiles_staff_all` is `FOR ALL` while the
trigger `profiles_guard_role` is `BEFORE UPDATE` **only**. So even with the trigger fixed, a `staff`
user could `DELETE` their own profile row and `INSERT` it back with `role='admin'` — a path the planned
fix would not have touched. The same policy also let a staff user delete the owner's profile row, which
is a permanent, app-unrecoverable lockout of the whole super-admin tier.

Both are closed by this migration.

## The design, and the one decision that shaped it

The app deliberately holds **no service-role key**, so a `SECURITY DEFINER` function is the only
privileged execution surface available. Everything follows from that:

- Invite tokens are 32 bytes of `gen_random_bytes`, hex-encoded, **stored only as a SHA-256 digest**.
  The raw value exists exactly twice: the function's return value, and the invitee's mailbox.
- `admin_invites` has **no INSERT/UPDATE/DELETE policy and no such grant** for `anon` or
  `authenticated`. Nothing reachable from the internet can create a row. **This is the specific thing
  that does not repeat `run-p5b-double-optin`**, where the anon INSERT surface let a caller supply a
  row id and self-confirm. There, the prize was an alert subscription; here it would be admin access.
- Redemption is granted to `authenticated` only, never `anon`, and matches the invite against the
  **caller's own email read from `auth.users` inside the definer** — not a parameter, not a JWT claim.
- Defence is layered, and the layer count is stated honestly: **three** layers for promoting another
  user (column grant → RLS → trigger), **two** for promoting yourself (column grant → trigger), because
  `profiles_update_own` legitimately permits own-row writes and so RLS does not defend there.

`is_staff()` is **deliberately not redefined** — roughly twenty policies across listings, photos,
features, price history, verification events and storage use it to mean "may work the listing panel",
and the owner's rule 1 is that staff admins keep full listing access. Narrowing it would have revoked
listing access from the very people this feature creates.

## Owner's five rules, as built

| # | Rule | How it is enforced |
|---|---|---|
| 1 | Staff keep full access to all listings | `is_staff()` untouched; no listing policy changed |
| 2 | Management surface = demote/revoke only | `revoke_staff_admin()`; `status`/`revoked_at`/`revoked_by` exist so cancel/resend/list are additive later |
| 3 | 7 days, single use | `expires_at` default + `status='pending'` and `expires_at > now()` inside the redemption WHERE — never in the caller |
| 4 | Existing buyer promoted in place | the upsert's UPDATE arm writes only `role`; same profile id, so favourites and history survive |
| 5 | No pending-invite UI | not built |

## Review

A **3-lens blind panel** reviewed the migration before any app code was written: correctness,
security/data, and simplicity/scope, mutually blind, each seeing only the artifact and the facts —
never another panelist's output or the author's reasoning.

**All three returned PASS WITH FIXES. No HALT, no Blocker.** They converged independently on:

1. a **fail-open denylist** — `current_user in ('anon','authenticated',…)` waved through any unlisted
   role; inverted to a fail-closed allowlist on `pg_has_role(current_user,'postgres','member')`
2. **no `BEFORE INSERT` guard** — the Route-2 path had two layers where UPDATE had three; the trigger
   is now `before insert or update`
3. **pgcrypto asserted, not assumed** — without it the file applies 100% clean and then throws on the
   first invite, because plpgsql bodies are not name-resolved at `CREATE` time
4. **three factually false comments** — "all three layers" (it is two for self-promotion), "auditable"
   demotion (it is not), and "no service_role key" (`scripts/upload-photos.mjs:29` uses one)
5. the **`email_confirmed_at` factor is contingent** on a Supabase project setting — see Parked

**Recorded disagreement** (§0 requires it, not resolved by vote): lens 2 wanted the `admin_invites`
SELECT grant column-scoped to exclude `token_hash`; lens 3 wanted the grant dropped entirely as surface
the owner declined. TL took column-scoping — it keeps rule 2's additive-later shape while removing the
exposure.

**Panel-flagged unknown, resolved by TL:** two reviewers noted that if a definer function owned by
`postgres` could not read `auth.users`, redemption would fail **silently** forever — indistinguishable
from a bad token. Verified live at intake: it can.

**Pre-apply gate, verified live before the migration was finalised:**

```
pg_has_role('anon','postgres','member')          => false  ✓
pg_has_role('authenticated','postgres','member') => false  ✓
pg_has_role('authenticator','postgres','member') => false  ✓
pg_has_role('service_role','postgres','member')  => false  ✓
pg_has_role('postgres','postgres','member')      => true   ✓
```

This had to be checked **before** apply, not after: a false result would have made the new guard a
silent no-op while the migration still applied cleanly and still looked successful.

## Verification

Independent BT (never fused with the builder) found **no functional defect in the implementation**.

- `npm run build` — clean, Next 16.2.12
- `npx tsc --noEmit` — clean · `npm run lint` — clean
- `npx vitest run` — **183 passing** at BT's verification, of which **136 are the pre-existing suite,
  individually confirmed still passing**. After the fix round below the new unit file went 47 → **67**,
  so the green total is **203**.
- **Test integrity clean:** zero pre-existing test files modified (`git diff --name-only` over
  `web/tests/` is empty)

BT found four **test-quality** defects, three on a non-negotiable, all fixed in-run:

1. **The "token never reaches the RSC payload" test was a tautology.** It asserted no 64-hex run
   appeared in a function whose input never contained a token — vacuously true, and it would have
   passed unchanged if `inviteAdmin` had leaked the token. Replaced with a real three-link proof:
   the token is asserted to actually be in the flow (it reaches `sendEmail`), a **canary test proves
   the detector itself fires** on a deliberately leaking result, and only then is the real result
   asserted token-free on both the send-success and send-failure branches. A negative assertion is
   worth exactly what its detector is worth.
2. **"The token is never logged" had no coverage at all.** Now a console spy across both invite
   branches, both fault paths and four redemption paths — unwrapping `Error` objects rather than
   `JSON.stringify`ing them, since `JSON.stringify(new Error(x))` is `{}` and would have hidden the
   exact regression it watches for.
3. The `secure` cookie attribute — the one keeping a 256-bit admin-granting secret off plaintext
   HTTP — was the only cookie attribute unasserted. Now asserted in both environments.
4. The nav gate used `role === 'admin'` instead of the `isSuperAdminRole()` predicate that exists to
   be the single definition.

A behaviour worth recording, found while writing those tests: **the invite cookie is cleared even when
the RPC throws**, and the clearing write carries the same `path: '/admin/invite'` scope — a plain
`delete(name)` would default to path `/`, clear a cookie that does not exist, and leave the real one
alive for replay. It was already correct; it is now pinned by a test.

## Applied to production — 2026-08-02

Owner approved the execution explicitly. Pre-apply snapshot captured first, because the rollback's
`grant` line depends on knowing the original state. That snapshot confirmed the hole was live and
slightly worse than documented: **both `anon` and `authenticated` held `UPDATE` on the `role` column**,
`profiles_staff_all` was present as an `ALL` policy, and `guard_profile_role` was `prosecdef = true` —
the SECURITY DEFINER bug that made the guard blind to its caller.

Post-apply verification, every claim checked rather than assumed:

| Check | Want | Got |
|---|---|---|
| `guard_profile_role` is SECURITY INVOKER | true | ✓ true |
| trigger fires on | INSERT+UPDATE | ✓ INSERT+UPDATE |
| `profiles_staff_all` dropped | gone | ✓ gone |
| `authenticated` table grants on `profiles` | no write | ✓ SELECT/TRUNCATE/REFERENCES/TRIGGER only |
| `authenticated` column grants | `update(full_name)` only | ✓ `UPDATE:full_name` |
| `anon` write grants on `profiles` | none | ✓ none |
| super admins | still 1 | ✓ 1 |
| `is_staff()` unchanged (rule 1) | true | ✓ true |
| `admin_invites` non-SELECT policies | 0 | ✓ 0 |
| `auth.users` readable by definer | true | ✓ true |
| pgcrypto schema | `extensions` | ✓ `extensions` |

**The headline criterion is now PROVEN.** `npx vitest run tests/vitest/admin-escalation-denial.integration.test.ts`
→ **13 passed**. A staff session cannot promote itself, cannot promote anyone else, cannot write any
role, cannot insert or delete a profile row, cannot create an invite, cannot demote, and cannot read
the invite table — each refused at the database. It retains `update(full_name)`, which proves the
revocation was not over-broad. Full suite: **216 passing across 15 files.**

Only the executable DDL was submitted; the commented source in `supabase/migrations/` remains
canonical. Comments do not execute, and a payload short enough to verify by eye was the safer choice
on a security migration.

## What the pre-apply state proved about the original risk

**AC3 — a staff admin cannot promote anyone, denied at the database — is written but NOT executed.**

There is no Docker and no local Postgres on this machine, so the only reachable Postgres is
**production**, and applying the migration there is the owner's ASK gate. Running the escalation test
pre-apply would not observe a denial — it would **perform a real privilege escalation against live
data**, because the hole is still open until the migration lands.

BT wrote `web/tests/vitest/admin-escalation-denial.integration.test.ts` (13 tests) with a `beforeAll`
interlock that **raises rather than skips** if `is_super_admin()` is absent, so the suite cannot quietly
green-light an unproven claim. Consequence: **`npx vitest run` exits 1 until the migration is applied.**
That is intended, and it is why this run does not claim GREEN.

The 13 tests cover: staff self-promotion; staff promoting another account; staff writing *any* role;
staff *retaining* `update (full_name)` (guards against over-revocation); denial of `create_admin_invite`,
`revoke_staff_admin` and `list_admin_accounts`; the Route-2 delete-then-reinsert path; `admin_invites`
unreadable by staff; `token_hash` unselectable; anon locked out of redemption; and a junk token getting
only the uniform `'invalid'`.

## Parked for the owner

1. **Apply the migration** — ASK-tier hard gate. `supabase/migrations/20260802021757_admin_invites_and_super_admin_split.sql`.
   Safe to apply **before** the app code ships (verified by two reviewers: the app only ever *reads*
   `profiles`, at four call sites). Reverse order breaks — new actions would 404 on the missing RPCs.
2. **Confirm "Confirm email" is ENABLED** in Supabase Auth. **This is a security precondition, not a
   preference.** All three live users are auto-confirmed with zero confirmation mail ever sent
   (`confirmation_sent_at = 0`, `email_confirmed_at = 3`), which is consistent with the setting being
   **off**. If it is off, the `email_confirmed_at` check proves nothing and the invite degrades from two
   factors to a **single-factor bearer token** — anyone holding a forwarded token could register the
   invited address and redeem into staff. Could not be read from SQL; it is not in the database.
3. **Push** — parked. The push IS the release here.
4. **Demotion audit trail** — the panel's single strongest recommendation, and BT re-raised it rather
   than accept the park. `revoke_staff_admin` records no actor, no timestamp, no target. Promotions
   leave a trail in `admin_invites.accepted_at/accepted_by`; revocations leave none. It needs a new
   table, so it parks as a proposal rather than being built inside a bounded wave.
5. **The super-admin tier is a single point of failure.** By design: no API path can mint an `admin` or
   demote one, so there is **no in-product way to appoint a second super admin** — only the Supabase
   dashboard. Recommended: create a second super-admin account with its own mailbox. Zero code.
6. **`/admin/sign-in` copy is now half-wrong** — it says accounts are not self-service, but invited
   admins do get one through a link.
7. **Registry drift** — `plan-critic`, `security-skeptic`, `logical-hunter` and `everyday-user` are named
   in `DISPATCH.md` but are **not installed**. The panel was convened from installed substitutes
   (`database-architect`, `security-tester`, `general-purpose`) with blindness preserved; the logic hunt
   ran inline.
8. **Accepted residual:** the raw token appears in **one** Vercel access-log line — the inbound
   `GET /admin/invite?token=…`. The redirect removes it from the address bar, the `Referer` and every
   later request, but cannot remove it from the log line that delivered it. Bounded by single-use,
   7-day expiry, and (subject to item 2) the mailbox factor.

## Rollback

The migration carries a commented rollback block and has **no point of no return**. Code:
`git revert -m 1 <merge-sha>`, or `git reset --hard 8b78512` for the whole run.
