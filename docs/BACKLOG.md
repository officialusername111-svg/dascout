# BACKLOG

> Canonical pending state (DISPATCH.md §0 "The standing queue"). Paths are repo-relative;
> prefix with `dascout/` from the workspace root. Entries are candidates — re-derive each
> from the repo at run start. Single writer: the orchestrating session only.
> Seeded 2026-08-06 from HANDOFF-2026-08-04-evening.md (the last date-stamped handoff).

## Now

- **Enhancement round v2 — Phases B and A DONE. C, D, E not started.** Run
  `do-me-2026-08-06-enhv2`, pre-run HEAD `12b415d`. Surface lock: home page + listing detail.
  - **Phase B shipped** — commit `a0a7dc7` on main, NOT pushed. Exclusivity note + `tel:`
    phone on `app/property/[slug]/page.tsx`, `.cta-note` in `globals.css`.
  - **Phase A shipped 2026-08-07**, NOT pushed. Built exactly to the settled spec: hero at
    `230%` / `57% 26%` with the 96%→90% scrim; the search card inverted to Dark glass
    (fallback and chevron inverted with it, which closed the 2.70:1 label contrast defect);
    `.expect` and `.ecard` on the artwork's measured warm gradients; four SOLID sprite icons
    with a gem replacing the star; `VerifiedBand()` now the supplied banner as a flat
    `<picture>` with the account button beneath. Detail in docs/HANDOFF.md.
  - Both commits are on `main` and **neither is pushed** — awaiting the owner's OK.
  - Phases C, D, E untouched. **E runs only on the owner's explicit signal.**

## Next

- [user-intake] Client enhancement round v2 (2026-08-06) — 9 items from
  `C:\Users\USER\Downloads\dascout.enhancement\`. Plan, task list and requirements in
  docs/PLAN-enhancement-v2.md. All five owner decisions ANSWERED 2026-08-06; nothing
  blocked. Five phases, run order B → A → C → D → E:
  B contact block (items 7,8, ships first) · A home visuals (1,2,3,4, sample first) ·
  C rich-text description (6) · D price show/hide (5) · E clear listings (9, on signal).
  Nothing built yet. NOTE: phase D reverses the "no peso anywhere public" standing rule —
  task D5 corrects CLAUDE.md and this file's Standing section in the same change.
- [user-intake] Piece 4 — approval-workflow refinement (BRIEF-listing-encoding-v2.md). Not started.
- [user-intake] Piece 5 — photos section redesign with icons. Brief says SAMPLE FIRST.
- [user-intake] Piece 6 — custom loading indicator. Brief says DIAGNOSE the freeze before styling.
- [user-intake] Piece 7 — remove the request-property function. Deliberately deferred;
  `property_requests.category` still blocks retiring `listing_category`.
- [agent-derived] Full-suite E2E account-spec interference — TEST_BUYER password not restored
  across specs 07/09/10/11/15 (HANDOFF-2026-08-04-evening.md §3; task chip task_3f5515f1).
  Needs the human's flip to `approved` before an autonomous run picks it up.
- [agent-derived, 2026-08-07] **Vitest: 5 integration files fail on `fetch failed`.**
  `admin-escalation-denial`, `reorder-photos-rpc`, `property-types-apply1` and two others
  fail at Supabase sign-in, and the failing set changes between runs. Proven environmental:
  with all Phase A edits stashed the same 5 files fail and 0 assertions fail. The host is up
  (`/auth/v1/health` → 401). Until it is diagnosed, "Vitest green" cannot be reached and the
  honest bar is "no new failures against a stashed baseline".
- [agent-derived, 2026-08-07] `web/public/assets/verified-fields.jpg` is now unreferenced
  (Phase A retired the aerial photo). Left on disk deliberately; a `/clean-me` job.
- [agent-derived, 2026-08-06] **Admin server actions hang without ever reporting back.**
  Found while verifying Phase B; NOT caused by it — a baseline run of
  `03-listing-journey.spec.ts` on `12b415d` with the Phase B edits stashed fails at the
  identical test. Symptom: the button stays on "Saving…"/"Working…" and the `.fmsg.ok`
  confirmation never appears, past a 45 s wait. Confirmed the write itself SUCCEEDS —
  the zz- listing left behind by the failed run had all 3 features saved — so the action
  completes server-side and only the response never reaches the client. Hit on
  `saveListingFeatures` (AC-13a) and `transitionListing` (AC-24a). Supabase is healthy
  (auth 200s at ~2 ms, 1 active connection), so it is not the database. Blocks the standing
  E2E half of the verification bar. Route to `/fix-me` — diagnosis first.
- [user-intake, recurring] V3 full-battery verification per docs/E2E-V3-RUNBOOK.md — on
  request, before any release, after any schema/grant change, or when a week has passed
  without one. Runs in-session (sweep needs the Supabase MCP); never as an OS job.

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
