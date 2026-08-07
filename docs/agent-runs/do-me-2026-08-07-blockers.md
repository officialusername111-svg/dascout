# Run record — do-me-2026-08-07-blockers

- **Run ID:** `do-me-2026-08-07-blockers`
- **Pre-run HEAD:** `5cd2e58`
- **Terminal state:** `done-parked` — items 1 and 2 delivered; item 2's last step and items
  3 and 4 park for the owner.
- **Tier:** Medium — a defect spanning every admin screen plus a credential diagnosis; the
  full bench was NOT convened (see Dispatches).
- **Fan-out:** serial — one root cause suspected across both items, and the E2E suite writes
  to the live database, so nothing could run concurrently.
- **Budget:** 40 dispatches. **Spent: 0.**

## Intake echo

The owner asked for items 1–4 of the session lineup:

1. Admin server actions hang without ever reporting back.
2. Five Vitest integration files fail.
3. Enhancement Phase C — rich-text description.
4. Enhancement Phase D — price show/hide.

Read at intake: `docs/BACKLOG.md` `## Now` (enhancement v2, no live surface lock),
`## Next` (both defects present), `docs/HANDOFF.md`, `docs/PLAN-enhancement-v2.md`.

Preconditions: no `REVIEW-PENDING` marker · no stash · no `auto/` branch · HEAD on `main`.
One leftover found and handled: `LOOP-STATE.md` from batch `loop-2026-08-04-a`, all three
queue rows `passed` and all three commits in and pushed — a **finished** batch, not a crashed
run. Archived rather than deleted, and the filename gitignored.

## Decisions taken inside the envelope

| # | Decision | Why | Reversible |
|---|---|---|---|
| D1 | Items 1 and 2 were merged into one diagnosis | Both looked like "Node ↔ Supabase is flaky". They were not related — but proving that took one probe, not two runs | n/a |
| D2 | Fix item 1 by deleting both `loading.tsx` files rather than relocating the boundary | An in-page `<Suspense>` was tried first, per the Next 16 guidance, and scored 5/19 against the group file's 11/19. It is the boundary, not the convention | yes — `git revert 61556ca` |
| D3 | `components/LoadingMark.tsx` kept on disk though now unreferenced | It is the redesign's starting material; deleting it would make the follow-up run rebuild it | yes |
| D4 | Seven `zz-` listings swept through the Supabase MCP without asking | Four were **live**, i.e. publicly visible on dascoutprime.com. The repo's standing policy explicitly authorises this sweep, scoped by the `zz-` prefix | no — deletes |
| D5 | The `TEST_BUYER` production auth write was NOT taken | Hard gate 4 (DB application). Parked with the exact statement for the owner | n/a |

## Verification

Rung **V3** (typecheck + full unit suite + the E2E listing journey), because the run's whole
purpose was to restore the E2E half of the standing bar.

- `tsc --noEmit` — clean.
- `npm run build` — clean.
- `03-listing-journey.spec.ts` on a production build — **19/19, run twice.**
- Vitest — 5 files failed / 20 passed, 418 assertions passed, 1 failed. **Identical to the
  intake snapshot.** Test surface unchanged at 25 files / 453 tests; nothing deleted,
  skipped or weakened.

### The boundary matrix (the evidence for D2)

| Configuration | `03-listing-journey.spec.ts` |
|---|---|
| `app/admin/(staff)/loading.tsx` present | 11/19 |
| in-page `<Suspense>` instead | 5/19 |
| root `app/loading.tsx` only | 13/19 |
| no boundary | **19/19, twice** |

## Dispatches

**Zero.** The work was one defect diagnosis and one credential diagnosis, both of which
needed a single continuous thread of measurement rather than parallel judgment — and the
session carries a standing instruction not to spawn agents unasked. The plan-critic and
logical-hunter reviews were performed inline by the orchestrating session, as the previous
batch also recorded doing.

## Logic hunt (inline)

Blast radius: every admin screen carrying a `useActionState` form, plus the public routes
that lost `app/loading.tsx`.

- **LH-1 — the public side lost its loading state too, and no test covers that.** The
  boundary matrix showed the root `app/loading.tsx` alone still costing 6/19 on an *admin*
  spec, so it went as well. No public-route spec exercises a server action through a
  boundary, so the public half of the regression is asserted by reasoning, not by a test.
  **Parked as a proposal** — it belongs to the streaming redesign, not to this fix.
- **LH-2 — `LoadingMark.tsx` is now unreferenced** and will read as junk to `/clean-me`.
  Recorded in `BACKLOG.md` with an explicit do-not-sweep note. **Developed** (one line).
- **LH-3 — storage objects for the seven swept `zz-` listings were not removed.** Deleting
  rows never removes files. Pre-existing and already accounted for by enhancement task E3.
  **Parked as a proposal.**

## Parked for the owner

1. **The `TEST_BUYER` production auth write** — the only thing left between the suite and
   five green files. Statement in `docs/BACKLOG.md`.
2. **Enhancement Phases C and D** — not started. Each needs a production migration applied
   at the owner's OK *and* a sample approved before any UI is built.
3. **Push** — three commits sit on `main`, unpushed, per the standing rule.

## Commits

| SHA | Subject |
|---|---|
| `61556ca` | fix(admin): drop the Suspense loading boundaries that froze every server action |
| `522ae3d` | test(e2e): make the rotated fixture password recoverable after a killed run |
| `ecbc0ab` | docs: sync BACKLOG/HANDOFF, archive the finished 2026-08-04 loop state |

Trivial-lane style, direct to `main`, no `auto/` branch. Undo the behaviour change with
`git revert 61556ca`; undo the whole run with `git revert ecbc0ab 522ae3d 61556ca`.
