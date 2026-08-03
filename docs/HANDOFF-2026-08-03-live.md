# Handoff — DaScout, 2026-08-03 (invite approval queue LIVE)

**Paths in this document are repo-relative. Prefix them with `dascout/` from the workspace root**
(`D:\Workspace\DaScout`), which is a workspace container, not the repo. The rule lives in
`D:\Workspace\DaScout\CLAUDE.md` and loads automatically.

Supersedes `docs/HANDOFF-2026-08-03.md` and every earlier handoff.

- **HEAD:** `8ff1afc` on `main`, **level with `origin/main`**. Working tree **clean**.
- **Tests:** Vitest **354 passed / 22 files — 0 failed, 0 skipped**
- **Live:** <https://dascoutprime.com> healthy. The invite approval queue is **deployed and the
  migration is applied**
- **Database:** 12 real listings (001–012, all live), 0 `zz-` rows, 1 `verification_event`,
  2 live invitations, 2 super admins, 1 staff, **0 audit rows**

---

## 1. The invite approval queue is LIVE

The migration `20260802204500_admin_invite_approval_queue.sql` was applied via the Supabase MCP and
the four commits were pushed together — `d3273a0..8ff1afc`. They had to go together: §5 of that
migration revokes `redeem_admin_invite` from `authenticated`, which kills the old Accept door **at
apply time**, and the replacement queue only existed in the unpushed commits.

### What was verified

| Check | Result |
|---|---|
| §6(b) `redeem_admin_invite` reachable by `authenticated` | **false** — the retirement took |
| `list_admin_candidates` / `approve_` / `decline_` reachable by `authenticated` | true |
| any of them reachable by `anon` | **false** |
| widened CHECK in force | `via in (invite_redeemed, revoked_by_super_admin, approved_by_super_admin)` |
| §6(a) the `auth.users` read from inside the definer | **2 rows** — not a falsely-empty queue |
| Suite after apply | **354 / 354**, up from 343 passed / 1 failed / 10 skipped, **no edits** |
| Old `/admin/invite/accept` | **404** — route and `actions.ts` both gone |
| Public site + admin routes | home / `?loc=` / property / sitemap / sign-in all 200; `/admin` and `/admin/admins` 307 to sign-in; no peso, no map |

The two red tests went green **without being edited**, which was the stated pass condition — had
either needed an edit, that was to be treated as a finding.

### ⚠ Two owner steps remain — the feature is not fully exercised until these are done

**A. Change the Supabase email template.** Cannot be done from a session.
`https://supabase.com/dashboard/project/kogpuuidawbmttyswvsx/auth/templates` →
**Authentication → Emails → "Confirm signup"**. Keep `{{ .ConfirmationURL }}` **and** add
`{{ .Token }}` — both derive from the same token, so link and code both work and nothing breaks
either way. Drop the link later, once a real signup has used the code.

**B. Walk `docs/TEST-PLAN-p9-approval-queue.md` §Group C** — ten numbered steps.
**Do not skip step 8, the audit check.** `admin_role_changes` currently has **0 rows**, so the
first real approval writes the first one. On that row assert all four, not three:

- `actor_id` = the super admin who pressed Approve
- `target_id` = the invited account — **and NOT equal to `actor_id`**
- `to_role = 'staff'`, `from_role = 'buyer'`
- `via = 'approved_by_super_admin'` (never `invite_redeemed`)

`actor_id = target_id` on that first row is the false-consent record the whole design exists to
prevent. No automated test can catch it — the unit tests stub the RPC and the integration tests
only assert 42501 refusals.

### One thing to expect in the queue

Both live invitations show `has_confirmed_account = true`. But `dascoutph@gmail.com` **is already a
super admin**, so approving that row returns `already_admin`, writes nothing, and deliberately
leaves the invitation pending so it can be cancelled on purpose. That is correct behaviour, not a
bug. Decline is the honest resolution for it.

---

## 2. Listing encoding v2 — DISCOVERED, NOT BUILT (unchanged)

`docs/BRIEF-listing-encoding-v2.md` is the spec **and** the plan. **§8b wins over §1–§9.**

- Only `draft` and `verifying` need renaming — keeping `live`/`sold`/`withdrawn` as stored values
  takes the whole public site out of the blast radius.
- `property_requests.category` blocks retiring the enum, and is not in the spec.
- `guard_listing_publish` is **redesigned, not removed** — it is the only database-side thing
  stopping a direct API call from skipping approval.
- Three applies, not one. Everything through apply 2 is reversible.

**Four questions must be answered before apply 1** (end of §8b): withdrawn source, frontage
visibility, nav groups, features FK scope.

**⚠ Apply 2 WILL STOP.** It asserts `verification_events` is empty before dropping the table, and
there is **1 row** — a `title_check` on **property 012, Villa Consuelo Modern Home**, recorded
2026-08-02 10:22 UTC. Decide what happens to that record first. Do not assume it is stray and do
not weaken the assertion.

---

## 3. Still open

| # | Item | Blocked on |
|---|---|---|
| 1 | **Email template + Group C walkthrough** (§1 above) | the owner |
| 2 | Listing encoding v2 | four questions, then apply 1 |
| 3 | Bulk actions from the mockup | the owner's call — bulk publish past the per-listing confirm is a new capability on a verification gate |
| 4 | `cleanup_backup` schema still in Supabase | `drop schema cleanup_backup cascade;` when satisfied |
| 5 | Migration ledger drift — now 4 files | `apply_migration` assigns its own timestamp; harmless via API, would confuse `db push`/`db reset` |
| 6 | `?loc=` / `?az=` edge cases | parked from the v6 run |
| 7 | Four superseded handoffs in `docs/` | consolidate or archive — a content call, see `CLEAN-HISTORY.md` |

**Settled, do not reopen:** "Confirm email" is ON (verified behaviourally 2026-08-02; it is not
SQL-readable). Test data is swept manually through the Supabase MCP — no service-role key, no purge
function, no separate project. Price is readable by any registered account. Approval by any listing
admin, including their own work, was chosen deliberately.

---

## 4. Traps that cost time, still true

- **The two-root path trap.** Prefix repo paths with `dascout/`. Four sessions lost opening tool
  calls to it.
- **A grant change and the code depending on it MUST ship together, in both directions.** Ten-minute
  outage on 2026-08-02. Grants that *widen* may land before the code; anything that *narrows* must
  land after it. **This migration narrowed** (§5's revoke) and that is exactly why apply and push
  had to be minutes apart.
- **`test-staff-p4@dascout.local` must keep `role = 'staff'`.** It looks like stale test cruft; both
  suites sign in as it and `admin-escalation-denial.integration.test.ts` asserts its role.
- **Making a super admin is SQL-only, by design.** `admin_invites.granted_role` is CHECK-pinned to
  `'staff'` so an invite can never mint the top tier:
  `update public.profiles set role = 'admin' where id = '<uuid>' and role = 'buyer';`
- **The admin form echoes what you submitted.** Asserting an input's value after Save proves
  nothing. Wait for the server's `.fmsg.ok` banner, or re-fetch.
- **PowerShell mangles UTF-8** — peso signs and em-dashes both. Do not round-trip source files
  through it.
- **`.pill` is absolutely positioned by default.** New admin surfaces rendering one inline need the
  `position:static` override in `globals.css`.
- **Playwright needs `npm run build` first** and takes port 3000. `web/.next` was deleted in this
  session's cleanup, so the next run rebuilds from cold.
- **A full Vitest run leaves `zz-` residue.** Swept at the end of this session. Sweep before writing
  any handoff.
- **`web/AGENTS.md` is real.** Next.js **16.2.12**, not the Next in your training data.
- **Never run `npm audit fix --force`** — it downgrades Next to 9.3.3.
