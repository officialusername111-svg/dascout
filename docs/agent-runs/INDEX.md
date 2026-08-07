# Autonomous run index

One line per run: run ID · date · terminal state · merge/revert SHA (or "no commit").

- run-p2-public-site · 2026-07-29 · done-green · merge a13d4c2 (revert: `git revert -m 1 a13d4c2`) — record predates docs/agent-runs, decision trail in the run transcript
- run-p4-admin · 2026-07-30 · done-green · merge 67c88ad (revert: `git revert -m 1 67c88ad`) — record: run-p4-admin.md
- run-v6-home-black · 2026-08-01 · done-green · merge 7cce7b6 (revert: `git revert -m 1 7cce7b6`) — record: run-v6-home-black.md
- run-p6-admin-invites - 2026-08-02 - done-green - merge 50f3198 (revert: `git revert -m 1 50f3198`) - record: run-p6-admin-invites.md - migration APPLIED to prod and verified; 13 escalation-denial tests pass; parked: push, and confirm Supabase "Confirm email" is ON before sending any invite
- do-me-2026-08-07-blockers · 2026-08-07 · done-parked · commits 61556ca 522ae3d ecbc0ab (revert: `git revert ecbc0ab 522ae3d 61556ca`) — record: do-me-2026-08-07-blockers.md — admin server-action hang root-caused to piece 6 Suspense boundaries and fixed (19/19 twice); TEST_BUYER credential desync re-diagnosed, one production auth write parked for the owner; enhancement Phases C/D not started (migration + sample gates)
