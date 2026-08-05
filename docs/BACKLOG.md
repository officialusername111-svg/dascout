# BACKLOG

> Canonical pending state (DISPATCH.md §0 "The standing queue"). Paths are repo-relative;
> prefix with `dascout/` from the workspace root. Entries are candidates — re-derive each
> from the repo at run start. Single writer: the orchestrating session only.
> Seeded 2026-08-06 from HANDOFF-2026-08-04-evening.md (the last date-stamped handoff).

## Now

(idle — no active run)

## Next

- [user-intake] Piece 4 — approval-workflow refinement (BRIEF-listing-encoding-v2.md). Not started.
- [user-intake] Piece 5 — photos section redesign with icons. Brief says SAMPLE FIRST.
- [user-intake] Piece 6 — custom loading indicator. Brief says DIAGNOSE the freeze before styling.
- [user-intake] Piece 7 — remove the request-property function. Deliberately deferred;
  `property_requests.category` still blocks retiring `listing_category`.
- [agent-derived] Full-suite E2E account-spec interference — TEST_BUYER password not restored
  across specs 07/09/10/11/15 (HANDOFF-2026-08-04-evening.md §3; task chip task_3f5515f1).
  Needs the human's flip to `approved` before an autonomous run picks it up.

## Parked

- `cleanup_backup` schema still in Supabase — blocked on: owner satisfaction; then
  `drop schema cleanup_backup cascade;` via MCP. Since 2026-08-02.
- Bulk actions from the admin mockup — blocked on: owner's explicit call (new capability on a
  verification gate). Unbuilt on purpose. Since 2026-08-02.
- Migration ledger drift (filename timestamps ≠ applied versions) — noted, low risk; harmless
  via API, would confuse `db push`/`db reset`. docs/MIGRATION-LEDGER-DRIFT.md. Since 2026-07-31.

## Decided — do not reopen

- 2026-08-02 — price_php readable by any REGISTERED account is ACCEPTED; closing it properly
  means a staff-only price table, deferred until the client wants it. Not a security finding.
- 2026-08-02 — property number: public, shown before the name, NOT required to publish, own
  column (no prefix) on the admin index.
- 2026-08-03 — test-data cleanup is NEVER automated: no service-role key, no purge function,
  no separate project/branch. Sweep zz- rows through the Supabase MCP only; scope by zz-
  prefix, never by status alone.
- 2026-08-04 — public `?cat=` taxonomy fixed at the five seeded types ("Split"); later types
  are visible but not in `?cat=`/nav. `DbCategory`/`CategoryKey` stays, sourced via join.
- Standing verification bar = Vitest + 03-listing-journey.spec.ts (both against a production
  build); the full E2E battery is fragile (see Next) and is not the bar.

## Standing

(mirror — `D:\Workspace\DaScout\CLAUDE.md` is authoritative)

- No peso amounts and no map anywhere public; admin may show peso.
- Commits go straight to main; NEVER push without asking.
- No Docker — production Supabase is the only reachable database; migrations apply via the
  Supabase MCP at the owner's OK, or not at all.
- A grant change and the code depending on it ship TOGETHER: widening lands before the code,
  narrowing lands after it (the 2026-08-02 outage; inverted-and-correct on 2026-08-04).
- Playwright needs `npm run build` first and takes port 3000; the E2E suite writes to the
  live database — prefer targeted specs. test-staff-p4@dascout.local stays role=staff.
- Show a sample before building any screen; reports in plain words; route via /do-me.
