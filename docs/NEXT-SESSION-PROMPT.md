# Prompt for the next session

Copy everything inside the block below into a fresh session.

---

```
Read docs/HANDOFF-2026-08-03.md first — it is the state of play. It SUPERSEDES every earlier
handoff in docs/.

PATHS: the repo is D:\Workspace\DaScout\dascout, one level BELOW the working directory
D:\Workspace\DaScout. Every path inside the repo's own docs and tool output is written
repo-relative — prefix it with dascout/ before you pass it to a tool. D:\Workspace\DaScout\CLAUDE.md
states this rule and loads automatically; read it if a path 404s.

NOTHING IS PUSHED. There are 3 commits on main ahead of origin/main. The working tree is clean.
I want ONE push covering the invite work and the listing work together, once the listing work is
done. Do not push before then, and ask me first when you do.

START HERE — pick one. They are independent.

A. MAKE THE INVITE APPROVAL QUEUE LIVE. It is built, committed and tested (343 passing), but the
   migration has never been executed anywhere. Handoff §1 has the five steps in order. Two of them
   are mine, not yours: the Supabase email-template change, and the ten-step walkthrough in
   docs/TEST-PLAN-p9-approval-queue.md. Do not skip step 8 of that walkthrough — the audit check.
   Apply the migration only at my OK, and expect the two red tests to go green WITHOUT edits; if
   either needs editing, that is a finding, not a fix.

B. BUILD LISTING ENCODING v2, piece 1 — the schema. Discovery is done and committed; no code exists
   yet. docs/BRIEF-listing-encoding-v2.md is both the spec and the plan.

   READ SECTION 8b BEFORE ANYTHING. It wins over sections 1-9 — the first part is what I asked for,
   8b is what the code says it costs. The four things it changes are load-bearing:
     - only draft and verifying need renaming; keeping live/sold/withdrawn as stored values takes
       the whole public site out of the blast radius
     - property_requests.category blocks retiring the enum, and is not in my spec
     - guard_listing_publish is REDESIGNED, not removed — it is the only database-side thing
       stopping a direct API call from skipping approval
     - three applies, not one migration

   ASK ME THE FOUR OPEN QUESTIONS at the end of 8b before writing apply 1: where Withdrawn can be
   reached from, whether frontage is public, whether new property types join the Lots/Buildings nav
   groups, and whether the features foreign-key fix is in scope now.

   ONE VERIFICATION EVENT NOW EXISTS on a real listing (property 012, Villa Consuelo). The migration
   asserts that table is empty before dropping it, so apply 2 WILL STOP. Ask me what to do with that
   record before you get there — do not assume it is stray, and do not weaken the assertion.

C. Something else entirely. Fine — just read the handoff first.

TEST DATA — the standing procedure, decided, do not reopen:
Do NOT automate cleanup. No service-role key, no purge function, no separate Supabase project.
When zz- rows build up, sweep them THROUGH THE SUPABASE MCP — that channel connects as postgres and
is not bound by RLS, which is why it can do what the test suite cannot. Scope by the zz- prefix,
NEVER by status alone — the old recipe did that and would destroy real drafts. The SQL is in the
handoff. A session with heavy test runs can leave dozens of rows: the last one left 69 listings and
162 events. Sweep before you write the handoff.

STANDING RULES:
- No peso amounts and no map anywhere public. Admin may show peso.
- Commits go straight to main. NEVER push without asking me.
- No Docker on this machine, so production is the only database you can reach. Migrations are
  applied via the Supabase MCP at my OK, or not at all — and there is no rehearsal, so read them.
- A grant change and the code depending on it must ship TOGETHER, in both directions. Getting that
  wrong took the site down for ten minutes on 2026-08-02. Grants that widen may land before the
  code; anything that narrows must land after it.
- The E2E suite writes to the live database — prefer targeted specs. 06-public-smoke and
  18-admin-redesign are read-only. Playwright needs `npm run build` first and takes port 3000.
- test-staff-p4@dascout.local must keep role=staff. It looks like stale test cruft; it is a
  load-bearing fixture both suites sign in as, and one test asserts its role.
- Route substantive work through /do-me, keep reports in plain words, and show me a sample before
  building any screen.
- Answer my question first. Only flag a risk if it is about to happen and I can act on it.
```
