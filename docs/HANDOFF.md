# HANDOFF — DaScout (single overwritten file)

> This file replaces the date-stamped handoff chain (DISPATCH.md §0 "The standing queue").
> It is OVERWRITTEN each handoff; git history keeps prior versions. The dated
> `HANDOFF-2026-*.md` files are retired — `HANDOFF-2026-08-04-evening.md` was the last one
> and remains valid history. Paths are repo-relative; prefix with `dascout/` from the
> workspace root (rule in `D:\Workspace\DaScout\CLAUDE.md`).

## Read first

1. `docs/BACKLOG.md` — the queue: Now / Next / Parked / Decided / Standing.
2. This file — only what changed since the last handoff, plus session quirks.

## State of play (as of 2026-08-06 seeding)

- HEAD `942c566` on `main`, pushed and live on dascoutprime.com; tree clean apart from
  untracked Playwright `test-results/`.
- Listing encoding v2 is COMPLETE through apply 3 (schema/core-flow scope): `listings.category`
  dropped, `property_type_id` NOT NULL, all live. Vitest 453/453; journey spec 19/19 against
  the migrated schema.
- Open work is in BACKLOG `## Next` (pieces 4–7 + the E2E interference fix).

## Session quirks worth knowing

- The path trap: repo is one level below the workspace — prefix everything with `dascout/`.
- Memory index: `C:\Users\USER\.claude\projects\D--Workspace-DaScout\memory\MEMORY.md`.

## Ready-to-paste next-session prompt

```
Continue DaScout. Read dascout/docs/BACKLOG.md first (the queue), then dascout/docs/HANDOFF.md.
Ask the owner which Next item to take — piece 4 (approval workflow), 5 (photos, sample first),
6 (loading indicator, diagnose first), 7, or the E2E interference fix — or route through
/do-me on "continue". Standing rules are in D:\Workspace\DaScout\CLAUDE.md and BACKLOG ## Standing.
```
