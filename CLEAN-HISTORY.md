# CLEAN-HISTORY — this file is append-only; each run adds a section, nothing is ever rewritten.

## 2026-08-02 · clean-me run (scope: project — `D:\Workspace\DaScout\dascout`)

Triggered by item 8 of `docs/HANDOFF-2026-08-02.md`: "5 spent `auto/` branches, 2 worktrees".
The branch count was right. The worktree count was not — `git worktree list` prints the main
checkout as its first row, so what looked like two worktrees was one worktree plus the repo
itself. One worktree was removed; the repo was not.

**Removed (Tier A — regenerable):**
- `.claude/worktrees/` — the now-empty parent directory left behind by the worktree removal
  below. Recreated automatically by the next worktree run.

**Removed (Tier B — git-recoverable):**
- worktree `.claude/worktrees/eager-hellman-4f36fe` — clean tree, no untracked files, HEAD
  `30b23ca` proven an ancestor of `main`. Restore: `git worktree add .claude/worktrees/eager-hellman-4f36fe 30b23ca`
- branch `auto/run-p2-public-site` — merged in `a13d4c2`; restore: `git branch auto/run-p2-public-site 316fd9c`
- branch `auto/run-p3-accounts` — merged in `c236484`; restore: `git branch auto/run-p3-accounts a0a29e7`
- branch `auto/run-p4-admin` — merged in `67c88ad`; restore: `git branch auto/run-p4-admin 9a23884`
- branch `auto/run-p6-admin-invites` — merged in `50f3198`; restore: `git branch auto/run-p6-admin-invites a786bcc`
- branch `auto/run-v6-home-black` — merged in `7cce7b6`; restore: `git branch auto/run-v6-home-black 9b42bf0`
- branch `claude/eager-hellman-4f36fe` — **not on the handoff's list of five**, but it is the
  branch the removed worktree was sitting on, and leaving it behind would have left exactly the
  dangling-merged-branch state this run exists to clear. Merged in `34934f5`;
  restore: `git branch claude/eager-hellman-4f36fe 30b23ca`

  Every branch above went through `git branch -d`, never `-D`. The `-d` guard refusing is the
  proof of merge; not one of the six refused.

**Removed (outside the tiers — on explicit instruction):**
- `REVIEW-PENDING.md` — normally Tier C and never removable on a janitor's own judgment, because
  its existence means a run is unreviewed. Removed here only because the owner opened the session
  with "Reviewed run-p6-admin-invites — you can delete REVIEW-PENDING.md", which is the
  acknowledgement DISPATCH.md §0 asks for. It is gitignored, so this is **not** git-recoverable;
  the run it marked is recorded permanently in `docs/agent-runs/run-p6-admin-invites.md`.

**Parked (Tier C — your call):**
- `docs/NEXT-SESSION-PROMPT.md` — untracked, 66 lines. Read, not judged by name: it is the
  previous session's handover prompt, and this session was started from it, so it is spent. It
  is still untracked authored work, so it parks. **Delete it, or should the next session's
  prompt keep living at that path?**

**Untouched on purpose:**
- `web/node_modules/` and `web/.next/` — Tier-A by pattern, but the dev server is running on
  port 3000 and serving out of both. A running site's folders are left alone.
- `docs/agent-runs/` — the permanent run record. Never cleaned; it is the audit trail.
- `.env` and every credential-bearing config — correctly untracked, which is exactly where they
  belong. Removing them would destroy the machine's configuration.
- `docs/mockups/admin-v1-proposed.html` — approved and unbuilt, i.e. pending work, not residue.

**Totals:** 1 worktree · 6 branches · 1 empty directory · 1 marker removed on instruction · 1 parked

_No files were hard-deleted except the empty directory and the acknowledged marker. Nothing was
committed by this run and nothing was pushed._
