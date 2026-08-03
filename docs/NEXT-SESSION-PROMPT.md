# Prompt for the next session

Copy everything inside the block below into a fresh session.

---

```
Read docs/HANDOFF-2026-08-03-live.md first — it is the state of play. It SUPERSEDES every earlier
handoff in docs/.

PATHS: the repo is D:\Workspace\DaScout\dascout, one level BELOW the working directory
D:\Workspace\DaScout. Every path inside the repo's own docs and tool output is written
repo-relative — prefix it with dascout/ before you pass it to a tool. D:\Workspace\DaScout\CLAUDE.md
states this rule and loads automatically; read it if a path 404s.

EVERYTHING IS PUSHED AND LIVE. main is level with origin/main, tree clean, Vitest 354/354 with
nothing skipped. The invite approval queue is deployed AND its migration is applied.

START HERE.

1. TWO STEPS OF MINE ARE OUTSTANDING and the invite feature is not proven until they are done.
   Handoff §1 has both. Ask me whether I have done them before building anything else:
     - the Supabase "Confirm signup" email template — keep {{ .ConfirmationURL }} and ADD
       {{ .Token }}
     - the ten-step walkthrough in docs/TEST-PLAN-p9-approval-queue.md §Group C
   DO NOT SKIP STEP 8, the audit check. admin_role_changes has 0 rows right now, so the first real
   approval writes the first one. Assert all four fields on it, and if actor_id equals target_id,
   STOP — that is the false-consent record the whole design exists to prevent, and no test catches
   it. Expect approving dascoutph@gmail.com to answer 'already_admin': that account is already a
   super admin, and that is correct behaviour, not a bug.

2. Then, if I say so: BUILD LISTING ENCODING v2, piece 1 — the schema. Discovery is committed; no
   code exists. docs/BRIEF-listing-encoding-v2.md is both the spec and the plan.

   READ SECTION 8b BEFORE ANYTHING. It wins over sections 1-9 — the first part is what I asked for,
   8b is what the code says it costs. The four things it changes are load-bearing:
     - only draft and verifying need renaming; keeping live/sold/withdrawn as stored values takes
       the whole public site out of the blast radius
     - property_requests.category blocks retiring the enum, and is not in my spec
     - guard_listing_publish is REDESIGNED, not removed — it is the only database-side thing
       stopping a direct API call from skipping approval
     - three applies, not one

   ASK ME THE FOUR OPEN QUESTIONS at the end of 8b before writing apply 1: where Withdrawn can be
   reached from, whether frontage is public, whether new property types join the Lots/Buildings nav
   groups, and whether the features foreign-key fix is in scope now.

   APPLY 2 WILL STOP. It asserts verification_events is empty and there is 1 row — a title_check on
   property 012, Villa Consuelo. Ask me what to do with that record before you get there. Do not
   assume it is stray and do not weaken the assertion.

3. Or something else — just read the handoff first.

TEST DATA — the standing procedure, decided, do not reopen:
Do NOT automate cleanup. No service-role key, no purge function, no separate Supabase project.
When zz- rows build up, sweep them THROUGH THE SUPABASE MCP — that channel connects as postgres and
is not bound by RLS, which is why it can do what the test suite cannot. Scope by the zz- prefix,
NEVER by status alone — the old recipe did that and would destroy real drafts. The SQL is in the
handoff. Sweep before you write the handoff.

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
  web/.next was deleted in cleanup, so the first build is from cold.
- test-staff-p4@dascout.local must keep role=staff. It looks like stale test cruft; it is a
  load-bearing fixture both suites sign in as, and one test asserts its role.
- Route substantive work through /do-me, keep reports in plain words, and show me a sample before
  building any screen.
- Answer my question first. Only flag a risk if it is about to happen and I can act on it.
```

---

## What changed from the previous prompt

The old prompt's item A — "make the invite approval queue live" — is **done**, so it is gone. What
replaced it is the part only the owner can do: the email template and the Group C walkthrough. The
audit check is spelled out with the actual current state (0 rows) because it is the one check no
automated test can ever cover.

The `already_admin` answer for `dascoutph@gmail.com` is called out by name, so the walkthrough
doesn't read it as a failure.

Listing v2 is unchanged apart from being demoted to second, and the `verification_events` warning is
kept verbatim because apply 2 will still stop on it.
