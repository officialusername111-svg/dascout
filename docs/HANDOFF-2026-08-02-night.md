# Handoff — DaScout, night of 2026-08-02

**Paths in this document are repo-relative. Prefix them with `dascout/` from the workspace root**
(`D:\Workspace\DaScout`), which is a workspace container, not the repo. The standing rule lives in
`D:\Workspace\DaScout\CLAUDE.md` and loads automatically every session.

Supersedes `docs/HANDOFF-2026-08-02-evening.md`. All three tasks that document listed as pending
are now closed.

- **HEAD:** `d3273a0` on `main`, **level with `origin/main`** — nothing unpushed
- **Working tree:** **dirty on purpose** — 8 items, see "The one open decision"
- **Tests:** Vitest **283 / 283** across 19 files. `tsc --noEmit` clean, `eslint` clean.
  Playwright `06-public-smoke` 4/4
- **Live:** <https://dascoutprime.com> healthy — home, `?loc=`, property page, sitemap, admin
  sign-in all 200; no peso, no price, no map on public pages
- **Database:** **12 listings, all live, all numbered 001–012. Zero `zz-` rows. Zero
  `verification_events`**

---

## What closed this session

**1. The admin v1 redesign and the property number are LIVE.** Pushed `12b6131..d3273a0` — three
commits, not the two the evening handoff predicted (`d3273a0`, the handoff itself, landed after it
was written).

Before pushing, the inverse of the morning's outage was checked: these commits add `property_no` to
`CARD_COLUMNS`, which is the **anon** query path, and the already-applied grant restricts anon to 17
named columns. `property_no` and `updated_at` are both in it, so the code asked for nothing anon
could not read. Had it been missing, the push would have broken the public site the same way the
morning's migration did, in reverse. **Verify this pairing in both directions, always.**

Deployment was confirmed by fetching the live CSS bundle and finding `.asegmented`, `.atoolbar`,
`.aabar`, `.atable` — proving the *new* build was serving, not that the old one was still healthy.

**2. All 12 listings are numbered 001–012**, entered through the admin form so the uniqueness index
was genuinely exercised. A deliberate duplicate attempt was correctly refused.

`001 - Dacera Heights Corner Lot` renders on the property page heading, tab title, OpenGraph title
and every home-page card.

Ordering: all 12 share one identical seeded `created_at`, so there is no real creation order. 001 is
Dacera because the owner's brief used it as the example; 002–012 are alphabetical by title.

**3. The `zz-` residue is gone.** 72 listings and 166 verification events deleted across two sweeps
(66+154 from previous runs, then 6+12 this session's own runs created).

---

## The one open decision

**The working tree is dirty and it is not accidental.** A global setup+teardown purge was built for
both suites, then the owner decided **not to adopt it**. The code is uncommitted:

```
 M docs/HANDOFF-2026-08-02-evening.md      <- corrected: says PUSHED, and states the path rule
 M web/playwright.config.ts                 <- wires globalSetup/globalTeardown
 M web/vitest.config.ts                     <- wires globalSetup
?? web/tests/purge-test-listings.ts         <- the guard + purge
?? web/tests/e2e/global-setup.ts
?? web/tests/e2e/global-teardown.ts
?? web/tests/vitest-global-purge.ts
?? web/tests/vitest/purge-test-listings.unit.test.ts   <- 6 guard tests (part of the 283)
```

**Decide one of these before doing anything else:**

- **Discard the purge, keep the doc fix.** Cleanest given the decision. The two config edits and the
  four new files go; `docs/HANDOFF-2026-08-02-evening.md` stays. Note the four are **untracked** —
  `git checkout` will not bring them back, so this is a real deletion.
- **Commit it dormant.** It is inert without a key and harmless, but it prints a large banner on
  every `vitest run` and every Playwright run, which is noise for a thing you decided against.
  If you keep it, quiet that banner first.
- **Leave it dirty.** Worst option — it will confuse the next `git status`.

Vitest is 283/283 *including* the 6 guard tests. Removing them drops it to 277/18 files, which is
the correct baseline if the purge goes.

---

## The residue: the decision and the standing procedure

**Decided: do not automate cleanup. Sweep it with the Supabase MCP when it builds up.**

No service-role key on the machine, no purge function, no separate project or Supabase branch.

**Why the suite cannot clean up after itself.** `verification_events` has RLS **enabled with zero
delete-capable policies** — the `authenticated` DELETE table grant is irrelevant, since grant *and*
policy must both allow it. It is also the only `RESTRICT` FK on `listings`. So a fixture that has
recorded a verification event cannot be deleted by anything RLS-bound, and the tests are RLS-bound:
they run in Node against PostgREST with the publishable key and a staff login.

**The MCP is a different, privileged channel** that connects as an admin role and is not bound by
RLS. That is why a Claude session can do this and a `vitest run` cannot. The capability was never
missing; it simply does not belong to the test suite.

**Only three fixtures actually accumulate.** Most specs self-clean —
`02-create-validation.spec.ts` deliberately keeps its fixtures event-free *so they stay deletable*.
The residue is exactly the set that cannot be: `verification-events`, `reorder-photos-rpc` and
`account-listing-views-rls` each insert verification events.
`account-listing-views-rls.integration.test.ts:102` says outright that such a fixture is
"permanently undeletable once it has events", withdraws it, and leaves it "for orchestrator sweep".
That sweep is the manual chore that never reliably happened. **Budget roughly 3 listings per full
Vitest run.**

**The sweep, via the Supabase MCP** — events first (the RESTRICT FK), scoped by prefix rather than
by status so a real draft is never caught:

```sql
delete from public.verification_events
where listing_id in (select id from public.listings where slug like 'zz-%' and status <> 'live');
delete from public.listings where slug like 'zz-%' and status <> 'live';
```

**Never scope this by `status <> 'live'` alone** — the older handoff's recipe did, and it would take
out real drafts the moment any exist. Today it was safe only because all 12 real listings happened
to be live.

**An option never fully explored,** if this is ever revisited: have those three tests find-or-create
ONE stable fixture by fixed slug instead of a new listing per run. Caps residue at 3 permanent rows
forever — no key, no migration, no privileged path. Unverified: some assert on event counts, which
would drift as events accumulate on a reused listing.

---

## Still open, carried forward

| # | Item | Blocked on |
|---|---|---|
| 1 | **The purge code decision above** | the owner |
| 2 | **Bulk actions** from the mockup — deliberately not built | the owner's call; bulk publish past the per-listing confirm is a new capability on a verification gate |
| 3 | **No second super admin** | one Supabase dashboard action, no code |
| 4 | **"Confirm email" setting unverified** | from the admin-invite work; not checked since |
| 5 | `cleanup_backup` schema still in Supabase | drop when satisfied: `drop schema cleanup_backup cascade;` |
| 6 | Migration ledger drift — now 3 files | `apply_migration` assigns its own timestamp; harmless via API, would confuse `db push`/`db reset` |
| 7 | `?loc=` / `?az=` edge cases | parked from the v6 run |

**Closed and not to be re-litigated:** price readable by any registered account. Staff and buyers
share the one `authenticated` role so no column grant separates them; closing it properly means
moving the price to its own staff-only table. The owner accepted the current bar. **It is a
decision, not an oversight.**

---

## Observations worth knowing, not defects

- **Your 12 real listings have zero verification events.** All 154 that ever existed belonged to
  fixtures. They were seeded straight to `live`, so nothing blocks them — but there is no recorded
  title check or ground validation for any real property.
- The property number is **public**, leads the name, is **not** required to publish (soft checklist
  item, never a blocker), and is **not** prefixed on the admin listings index, which has its own
  column for it.

---

## Traps that cost time today

- **The two-root path trap.** Cost the first tool calls of a fourth session. Now fixed by rule
  rather than by warning — `D:\Workspace\DaScout\CLAUDE.md`, auto-loaded. Prefix repo paths with
  `dascout/`.
- **The admin form echoes what you submitted.** Asserting an input's value after clicking Save
  proves nothing — it passes even when the write failed. One of the twelve property numbers silently
  did not save this way. Wait for the server's `.fmsg.ok` banner, or re-fetch, or check the database.
- **PowerShell mangles UTF-8.** `Get-Content` piped to `Set-Content` turned every em-dash into
  mojibake during a bulk import-path rewrite. Do not round-trip source files through PowerShell —
  use the editing tools, or `[IO.File]` with explicit UTF-8.
- **A grant change and the code depending on it MUST ship together** — in *both* directions. This
  took the site down for ten minutes this morning.
- **`.pill` is absolutely positioned by default.** Any new admin surface rendering one inline must
  be added to the `position:static` override in `globals.css`.
- **`publishChecklistFor` and `publishBlockersFor` are two functions on purpose** — what the screen
  SHOWS versus what actually STOPS a publish. The soft property-number item must never reach the
  blockers; `admin-redesign.unit.test.ts` asserts it cannot.
- **No Docker, no local Postgres.** Production is the only reachable database. Migrations are
  applied via MCP at the owner's OK, or not at all.
- **Playwright needs `npm run build` first** and takes port 3000 with `reuseExistingServer: false`.
  `06-public-smoke` and `18-admin-redesign` are read-only and safe.
- **`web/AGENTS.md` is real.** Next.js **16.2.12**, not the Next in your training data.
- **Commits go straight to `main`. Never push without asking.** Vercel deploys in ~20s.
- **Never run `npm audit fix --force`** — it downgrades Next to 9.3.3.
