# TEST PLAN — admin invite approval queue (run-p9)

Paths are repo-relative; prefix with `dascout/` from the workspace root. Run `npm`/`npx` from
`dascout/web`.

**State at writing:** Vitest **342 passed / 1 failed / 10 skipped**; `tsc`, `lint`, `build` clean.
Both red things are pending-apply gates, not defects. Migration
`supabase/migrations/20260802204500_admin_invite_approval_queue.sql` is written and **NOT applied**.

## Why this plan exists

An independent verifier confirmed the code but could not verify behaviour, because **no statement in
the migration has ever been executed by any engine.** There is no local Postgres, no Docker and no
CLI on this machine — production is the only database. So the app-side logic is well covered and the
database side is desk-checked and unproven.

The plan splits on that line.

---

## Group A — testable now, without the migration

| # | What | Why it matters | Status |
|---|---|---|---|
| A1 | The three welcome-page branches | Zero coverage today; verified by source reading only | **To write** |
| A2 | Retirement detector hardened against backticks, concat and the PostgREST URL form | The verifier defeated the current pattern 4 ways out of 5 | In progress (builder) |
| A3 | Source walk covers `web/proxy.ts` | The test asserts "NO application module" but skips Next 16's middleware | In progress (builder) |
| A4 | Uniform-refusal invariant, conditional on the grant | Removing it left a non-enumeration property untested on a path §6 invites restoring | In progress (builder) |
| A5 | `/confirm` rejects `?email=` | The codebase's own rule forbids personal data in query strings | In progress (builder) |

**Constraint on A1.** Vitest runs `environment: 'node'` with **no jsdom**, so a React component
cannot be rendered in this suite. Two honest options, in preference order:

1. If the welcome page renders from a pure view-selector (the builder used `describeAcceptView` for
   the sibling screen), test the selector — behaviour, no DOM.
2. If it does not, this becomes a Playwright case in Group C rather than a reason to add jsdom.
   **Do not scaffold jsdom for one page.**

---

## Group B — green the moment the owner applies

Already written and gated. They must go green **without edits** on apply; if they need editing, that
is a finding.

| # | What | Where | Gate |
|---|---|---|---|
| B1 | 10 denial tests: staff and buyer refused by all three functions | `admin-approval-queue-denial.integration.test.ts` | throws `MIGRATION NOT APPLIED` |
| B2 | A staff caller can no longer reach `redeem_admin_invite` | `admin-escalation-denial.integration.test.ts` (1 of 13) | throws `RETIREMENT NOT APPLIED` |

**B3 — must be written after apply, cannot be written before.** The audit-trail assertion. This is
the verifier's most consequential gap: if `approve_admin_invite` were edited to write
`actor_id = target` — a plausible copy-paste from `redeem_admin_invite`, which legitimately does
that — **every current test still passes**, because the unit tests stub the RPC and the integration
tests only assert refusals. The first evidence would be a statutory record naming the wrong actor.

It requires a real approval, which requires super-admin credentials the suite does not hold. So it
is a **manual check in Group C**, promoted to an automated test only if a super-admin fixture is ever
added.

---

## Group C — needs a browser, a mailbox, or the owner's own hands

The suite holds only `TEST_STAFF_EMAIL` (staff) and `TEST_BUYER_EMAIL` (buyer). It has **no
super-admin credentials**, which is why every integration test here is denial-only: proving the
*grant* path works means promoting a real person in production and unpicking it by hand.

### The post-apply walkthrough

Run these in order. Stop at the first one that fails.

**1 — Apply the migration.** Via the Supabase MCP, not the dashboard, so it lands in the ledger.

**2 — Prove the three functions exist and the revoke took.**

```sql
select p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_may_call
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('list_admin_candidates','approve_admin_invite',
                    'decline_admin_invite','redeem_admin_invite')
order by 1;
```

Expect all four present. **`redeem_admin_invite` must show `false`** — that is the retirement. The
other three must show `true`.

**3 — Prove the audit vocabulary widened.**

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.admin_role_changes'::regclass and contype = 'c';
```

Expect `approved_by_super_admin` in the `via` CHECK. If the old two-value constraint is still there,
**stop** — the migration's own assertion should have caught this, and it not catching it is a defect.

**4 — Run the suite.** `npx vitest run` from `dascout/web`. Both gated files must now be green with
**no edits**. Expect roughly 353 passing, 0 skipped.

**5 — Deploy the code**, then change the Supabase email template. Order matters: the retirement
takes effect at apply, so the old Accept links die before the new pages ship.

Dashboard → **Authentication → Emails → Templates → "Confirm signup"**. Keep `{{ .ConfirmationURL }}`
**and** add `{{ .Token }}` — both come from the same token, so link and code both work and neither
path breaks. Drop the link later, once step 7 has succeeded once.

**6 — Check the queue renders.** Open `/admin/admins`. The **Invitations** panel should show the two
live invitations (`official.username111@gmail.com`, `dascoutph@gmail.com`, both expiring
2026-08-09). `dascoutph` is already a super admin — approving it should answer *already an admin* and
change nothing.

**7 — One real invitation, end to end.** The only test of the derived "pending" predicate.

1. Invite an address you control
2. Confirm the email carries a **bare** `https://dascoutprime.com/admin/invite` — no `?token=`, no
   64-character hex string anywhere in the body
3. Open it, create the account
4. Confirm the code email arrives with a 6-digit code
5. Enter the code; expect the "it is with the owner" screen, and **no admin access yet**
6. Confirm they appear in your queue as **Ready**, showing their own name
7. Press **Approve**
8. Confirm they receive the approval email
9. Have them reload — the admin panel should be there **with no re-login**

**8 — The audit check (B3), the one that cannot be automated.** Immediately after step 7:

```sql
select actor_id, target_id, from_role, to_role, via, changed_at
from public.admin_role_changes order by changed_at desc limit 1;
```

- `actor_id` must be **your** profile id — **not** the person you just approved
- `target_id` must be **theirs**
- `via` must be `approved_by_super_admin`

**If `actor_id` equals `target_id`, stop and report it.** That is the false-consent record this
whole design exists to prevent, and no automated test in the suite would catch it.

**9 — Decline, which is also cancel.** Decline the redundant `dascoutph` invitation. Confirm it
leaves the queue and that `admin_invites` shows `status = 'revoked'` with `revoked_at` and
`revoked_by` set.

**10 — Sweep the residue.** A full Vitest run leaves roughly three `zz-` listings. Scope by the
prefix, never by status alone:

```sql
delete from public.verification_events
where listing_id in (select id from public.listings where slug like 'zz-%' and status <> 'live');
delete from public.listings where slug like 'zz-%' and status <> 'live';
```

### Not covered by any of the above

- **The welcome page's three branches as rendered** — if A1 option 1 is unavailable, add a read-only
  Playwright case rather than jsdom.
- **What a declined person sees** — nothing, by design. They are not notified. No test needed;
  recorded so nobody "fixes" it.
- **Mail delivery itself.** Every email assertion is against the body a pure function returns, never
  against a delivered message. Whether the provider actually delivers is proved only by step 7.

---

## What is deliberately not tested, and why that is acceptable

- **The grant path, automated.** Needs super-admin credentials in the suite. Adding them would put a
  credential that can promote anyone into `.env.local` and into every test run against production.
  The denial tests plus the manual walkthrough are the honest trade.
- **`redeem_admin_invite`'s internals.** Retired. Its unreachability is asserted; its behaviour is
  not, and does not need to be while the grant stays revoked. **If the grant is ever restored, A4
  becomes load-bearing again** — that is why it is conditional rather than deleted.
