# E2E V3 runbook — the full-battery verification rung (DISPATCH.md §0 ladder)

> Paths are repo-relative; prefix with `dascout/` from the workspace root.
> V3 = full Vitest + full Playwright. It is **release-gated or on-request** ("run V3"),
> never per-run — the standing bar for ordinary runs stays Vitest + 03-listing-journey.
> The suite WRITES TO THE LIVE DATABASE; the sweep at the end is not optional.

## Why this is a runbook and not a scheduled job (decided 2026-08-06)

The post-run sweep must go through the Supabase MCP (standing procedure: no service-role
key, no purge function), and the MCP only exists inside a Claude session. An unattended OS
job could run the tests but not the sweep — leaving zz- residue on production, which is the
exact failure the procedure forbids. So V3 runs inside a session, on request or before a
release (ship-me pays this rung automatically).

## The run, in order — each step confirmed before the next

1. Preconditions: tree clean or stashed; no dev preview running (Playwright takes port 3000);
   `web/.env.local` present.
2. `cd dascout/web && npm run build` — Playwright needs the production build.
3. `npx vitest run` — expect the full count green (453/453 as of 2026-08-04).
4. `npx playwright test` — full battery. Known fragility: account specs 07/09/10/11/15 can
   interfere via the shared TEST_BUYER password (BACKLOG `## Next`, task_3f5515f1). Retry a
   failed spec once before treating it as real; record survivors as findings.
5. **Sweep** — through the Supabase MCP only: delete zz-prefixed residue, scoped by the
   `zz-` prefix, NEVER by status. `verification_events` no longer exists (apply 2);
   check the current FK graph before deleting if the schema moved.
6. File outcomes into `docs/BACKLOG.md`: failures → `## Next` as `agent-derived` findings;
   the run itself → one line in the report/packet naming rung V3.

## Cadence

On request ("run V3"), before any release (ship-me), and after any schema/grant change.
If a week passes with none of those, the recurring BACKLOG entry is the reminder — a session
picks it up at the owner's word.
