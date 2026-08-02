# Prompt for the next session

Copy everything inside the block below into a fresh session.

---

```
Read docs/HANDOFF-2026-08-02-night.md first — it is the state of play. It SUPERSEDES both
docs/HANDOFF-2026-08-02.md and docs/HANDOFF-2026-08-02-evening.md.

PATHS: the repo is D:\Workspace\DaScout\dascout, one level BELOW the working directory
D:\Workspace\DaScout. Every path inside the repo's own docs and tool output is written
repo-relative — prefix it with dascout/ before you pass it to a tool. D:\Workspace\DaScout\CLAUDE.md
states this rule and loads automatically; read it if a path 404s.

Everything is pushed and live. Nothing is unpushed. The admin redesign and property numbers
001-012 are on dascoutprime.com and verified.

START HERE — one decision, then your pick of the backlog.

1. The working tree is dirty ON PURPOSE. I had a Playwright/Vitest cleanup purge built, then
   decided against adopting it. Four untracked files plus two config edits are sitting there.
   The handoff's "The one open decision" section lists them and the three ways to resolve it.
   My inclination is to DISCARD the purge and keep only the corrected evening handoff doc —
   confirm with me before deleting, because the four files are untracked and git cannot bring
   them back. Vitest is 283/283 today; dropping the purge's 6 guard tests returns it to 277.

2. Then whichever of these I point you at:
   - Bulk actions from the approved mockup (docs/mockups/admin-v1-proposed.html). Deliberately
     not built. ASK ME FIRST — bulk publish past the per-listing confirm is a new capability on
     a verification gate, not a layout change.
   - A second super admin — one Supabase dashboard action, no code.
   - Verify the "Confirm email" auth setting, still unchecked since the invite work.
   - Drop the cleanup_backup schema once I say I'm satisfied.

TEST DATA — the standing procedure, already decided, do not reopen:
Do NOT automate cleanup. No service-role key, no purge function, no separate Supabase project or
branch. When zz- rows build up, sweep them THROUGH THE SUPABASE MCP — that channel is a privileged
admin role and is not bound by RLS, which is exactly why it can do what the test suite cannot.
Budget ~3 listings per full Vitest run; three integration tests create verification_events and
those fixtures are permanently undeletable under RLS. The sweep SQL is in the handoff. Scope it by
the zz- prefix, NEVER by status alone — the old recipe did that and would destroy real drafts.

STANDING RULES:
- No peso amounts and no map anywhere public. Admin may show peso.
- Commits go straight to main. NEVER push without asking me.
- No Docker on this machine, so production is the only database you can reach. Migrations are
  applied via the Supabase MCP at my OK, or not at all.
- The E2E suite writes to the live database — prefer targeted specs. 06-public-smoke and
  18-admin-redesign are read-only. Playwright needs `npm run build` first and takes port 3000,
  so stop any dev preview before running it.
- A grant change and the code depending on it must ship TOGETHER, in both directions. Getting
  that wrong took the site down for ten minutes on 2026-08-02.
- Route substantive work through /do-me, and keep the reports in plain words.
```

---

## Why these were chosen

Item 1 is first because a dirty working tree misleads every later `git status`, and the four
untracked files are unrecoverable once deleted — so it needs a human answer before anything else
touches the tree.

The test-data paragraph is stated as a settled procedure rather than a question because it was
re-litigated three times in one session. The MCP-versus-suite distinction is spelled out because
the reason the suite cannot self-clean is genuinely non-obvious: the capability exists, it just
belongs to a privileged channel that only exists inside a Claude session.

The `?loc=` / `?az=` edge cases and the migration ledger drift are deliberately left off the
prompt. Both are logged in the handoff, neither is worth opening a session for.
