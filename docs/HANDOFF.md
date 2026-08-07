# HANDOFF — DaScout (single overwritten file)

> This file replaces the date-stamped handoff chain (DISPATCH.md §0 "The standing queue").
> It is OVERWRITTEN each handoff; git history keeps prior versions. The dated
> `HANDOFF-2026-*.md` files are retired — `HANDOFF-2026-08-04-evening.md` was the last one
> and remains valid history. Paths are repo-relative; prefix with `dascout/` from the
> workspace root (rule in `D:\Workspace\DaScout\CLAUDE.md`).

## Read first

1. `docs/BACKLOG.md` — the queue: Now / Next / Parked / Decided / Standing.
2. This file — only what changed since the last handoff, plus session quirks.
3. `docs/PLAN-enhancement-v2.md` — the nine client items, the five owner decisions, the
   five phases and their task IDs.

---

## State of play — 2026-08-07 evening

Run `do-me-2026-08-07-blockers`, pre-run HEAD `5cd2e58`. The owner asked for items 1–4 of
the session's lineup. **Items 1 and 2 are done. Items 3 and 4 (enhancement Phases C and D)
were not started** — both are gated on a production migration AND on the standing
sample-before-build rule, so neither could be cleared inside an autonomous run. The reasons
are recorded in `BACKLOG.md ## Next`.

### The admin server-action hang — root cause found, fixed, verified

This was the blocker under everything else: `03-listing-journey.spec.ts` could not run to
completion, so the E2E half of the standing verification bar was unreachable.

**It was never a network, database or Supabase problem.** It was piece 6's loading
indicator. `app/loading.tsx` and `app/admin/(staff)/loading.tsx` each put a Suspense
boundary ABOVE `ListingActionBar` and `ListingForm` — the client components that hold
`useActionState`. On Next 16 that makes the browser keep **two copies** of the admin page
after a server action's `revalidatePath` re-render. The stale copy never leaves
`pending === true`, so the button sits on "Working…"/"Saving…" forever while the write has
already committed.

How it was proven, in order:

1. `console.log` probes inside `transitionListing` showed the DB flip, both `revalidate*`
   calls and the return all landing inside the same millisecond, and `after()` finishing
   808 ms later — while the client sat for the full 10 s assertion timeout. So the server
   was never slow; the response was never applied.
2. The duplication then caught itself: Playwright reported a strict-mode violation where
   `#lf-title` resolved to **2 elements**, the second one inside a second copy of the
   new-listing page.
3. Boundary matrix, same spec, same machine, one variable:

   | Configuration | Result |
   |---|---|
   | group `loading.tsx` present | 11/19 |
   | in-page `<Suspense>` instead of the group file | 5/19 |
   | root `app/loading.tsx` only | 13/19 |
   | **no boundary at all** | **19/19, twice** |

**The fix is the deletion of both `loading.tsx` files.** An in-page `<Suspense>` was tried
first, because that is what the Next 16 guidance suggests, and it was *worse* — it is the
boundary, not the file convention.

**What that costs, and it is a real cost:** piece 6 is reverted. Navigation blocks again —
~450–670 ms on public routes, ~2 s on the admin listing detail page — with no indicator.
`components/LoadingMark.tsx` is kept on disk and is now unreferenced; it is the starting
material for the proper fix, not junk. The proper fix is in `BACKLOG.md ## Next`: split the
admin listing detail fetch so the action bar renders from one fast query and the heavy
panels stream behind boundaries placed **below** it.

**Standing warning for anyone touching loading UI here:** a Suspense boundary in the wrong
place passes `tsc` and passes `npm run build`. Only `03-listing-journey.spec.ts` catches it.
Re-run that spec on any loading change.

### The five failing Vitest files — re-diagnosed, and the old diagnosis was wrong

The previous handoff called this "`fetch failed`, environmental, the failing set changes
between runs". As of 2026-08-07 that is not what happens. The error is
`Buyer sign-in failed: Invalid login credentials`; it is deterministic; and it is exactly
the five files that call `buyerClient()`.

Measured directly against `/auth/v1/token`: the staff fixture signs in 3/3, the buyer fails
3/3. `auth.users` confirms the buyer account is present, confirmed, not banned, with a
bcrypt password last touched 2026-08-04. This is `task_3f5515f1`, now proven rather than
suspected.

**Why nobody could just fix it:** `11-account-password.spec.ts` rotated the fixture to
`Zz-Bt-Temp-${Date.now()}` and the run died before its `afterAll` restore ran. The account's
real password is therefore a timestamp that only that dead process ever held.

**Recurrence is closed** — that constant is now `Zz-Bt-Temp-Fixture-Rotation`, fixed, so any
later run's restore loop can sign in with it and put the original back. The rotation still
happens through the real UI; nothing about what the test proves has changed.

**One action is left and it is the owner's**, because it is a write to production auth:

```sql
update auth.users
set encrypted_password = crypt('<the TEST_BUYER_PASSWORD value from web/.env.local>', gen_salt('bf'))
where email = 'test-buyer-p4@dascout.local';
```

Nothing else reaches it: the address is `.local` with no mailbox, so password recovery is
out, and there is no service-role key by policy.

### Rate limiting — ruled out, but worth knowing

While chasing the sign-in failures, a probe found Supabase auth returns
`429 over_request_rate_limit` at roughly 30 password sign-ins in quick succession. Vitest
runs 25 files across 12 workers and several sign in more than once, so this is close. It was
NOT the cause of anything seen this session, but it is the failure that will appear next if
the suite grows.

---

## Verification that ran

- `tsc --noEmit` clean.
- `npm run build` clean.
- `03-listing-journey.spec.ts` against a production build: **19/19, run twice.**
- Vitest: 5 files failed / 20 passed, 418 assertions passed, 1 assertion failed — **identical
  to the intake baseline**. No new failures. No test deleted, skipped or weakened.

## Test residue — swept

Seven `zz-` listings were left by the failed diagnostic runs, four of them **live and
therefore publicly visible**. All seven were deleted through the Supabase MCP, scoped by the
`zz-` prefix (never by status). 13 real listings remain, 0 `zz-` rows left.

Their photo objects in the storage buckets were NOT removed — deleting rows never removes
files. That is the same known gap piece E2/E3 already accounts for.

## Session quirks worth knowing

- **`stdout: 'pipe'` on `playwright.config.ts`'s `webServer` block is how you see server
  `console.log` output during a spec run.** Without it Playwright swallows it. It was added
  temporarily for this diagnosis and reverted; add it again the next time a server-side
  timing question comes up.
- **Browser-pane screenshots fail intermittently** — verify by computed style and
  `getBoundingClientRect` via `javascript_tool` when that happens.
- **The Bash tool is bash, not PowerShell** — `-m @'…'@` here-string syntax leaks a literal
  `@`. Use a heredoc into a file and `git commit -F`. (Commit `a0a7dc7`'s subject is a bare
  `@` for exactly this reason; it is already pushed, so amending it would rewrite shared
  history — leave it.)
- `LOOP-STATE.md` from the finished 2026-08-04 batch was archived to
  `docs/agent-runs/loop-2026-08-04-a-LOOP-STATE.md` and the name is now gitignored, so a
  fresh `/loop-me` no longer tries to resume a completed queue.

## Standing rules that bit this round

- Commits go straight to `main`. **Never push without asking.**
- The E2E suite writes to the live database — prefer targeted specs, and sweep `zz-` rows
  afterwards through the Supabase MCP.
- Playwright needs `npm run build` first and takes port 3000; stop any dev preview.
- `npm`/`npx` run from `dascout/web`; `git` runs from `dascout`.
