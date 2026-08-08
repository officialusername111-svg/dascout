# Next session — ready-to-paste opening prompt

> Written 2026-08-08 at the end of run `do-me-2026-08-08-phased`. Paths here are
> repo-relative; prefix with `dascout/` from the workspace root. Paste everything between
> the rules into a fresh session.
>
> This replaces the previous NEXT-SESSION.md, whose session has run.

---

/do-me Phase E — clear the listing database. This is the last item in the client
enhancement round; B, A, C and D are done, pushed and live. Read `docs/BACKLOG.md` first —
it is the canonical state, and its `## Hard-won rules` section is the part that matters —
then `docs/HANDOFF.md`, then `docs/PLAN-enhancement-v2.md` tasks E1–E5, then this file's
"Detail" section.

**The owner has given the signal.** Phase E runs.

**But it is irreversible and the site is live**, so three things gate it, in this order,
and none may be skipped or reordered:

1. **A backup must exist and be readable BEFORE anything is deleted.** Not "attempted" —
   read it back and confirm the rows are in it. There is no Docker on this machine, so no
   `pg_dump`; export through the Supabase MCP and save it under
   `docs/agent-runs/` or a path the owner names.
2. **One decision is still open and it is the owner's: do the property numbers restart at
   `001`, or are they retired?** All 13 current listings are numbered. Ask this as a direct
   question and wait — do not pick a default. It changes nothing technically; it changes
   what the office quotes on the phone.
3. **Clearing the rows empties the public site.** dascoutprime.com currently shows 13 live
   listings and will show none. Confirm the owner wants that to happen now, not just
   eventually.

Work through E1–E5. Do not batch them; verify after each.

---

## Detail the prompt above depends on

### What is actually in there, measured 2026-08-08

| | Count |
|---|---|
| `listings` | **13 — all `live`**, so all 13 are publicly visible right now |
| `listing_photos` rows | 42 (only **35 distinct** `storage_path` values — some rows share a file) |
| `property_requests` | 0 |
| Storage objects, `listing-photos` (public bucket) | **115** |
| Storage objects, `listing-photos-draft` (private bucket) | **19** |

### Two things the plan did not know, and they change the work

**E2 is simpler than PLAN-enhancement-v2.md assumes.** Every foreign key into `listings`
already **CASCADEs** — `favorites`, `listing_features`, `listing_photos`,
`listing_status_changes`, `listing_views`, `price_history`, `request_match_alerts`. Deleting
the listing rows cleans all seven automatically. There is no orphan hunt to do, and the
`verification_events` RESTRICT key that used to make fixtures undeletable is gone (listing
encoding v2 apply 2). `property_requests` has no foreign key to `listings` at all and is
empty regardless — but it is the table that still blocks retiring `listing_category`
(piece 7), so **do not drop it**.

**E3 is bigger than the plan assumes.** There are **134 stored files against 42 photo rows**.
Roughly 99 of them are already orphaned — left behind by earlier deletions, because deleting
a row has never removed the file. So E3 is not "delete the files for these 42 rows"; the
buckets need emptying, and the count you should expect to remove is ~134, not ~42. Verify
both buckets read as empty afterwards rather than trusting the delete's return value.

### The order that matters

Rows first, then files. If files went first, a listing page could still be live and pointing
at a photo that no longer exists — a broken page rather than an absent one. Clearing rows
first makes the listings vanish, and the files become unreferenced junk that E3 then sweeps.

### Verification bar for this phase (E5)

- `sitemap.ts` renders with zero listings and does not throw. It is a **cached route** —
  revalidate it, or it will keep serving the old URLs.
- The live site renders cleanly empty: home page, the `?cat=` category views, and search.
  `globals.css` has an `.empty` treatment; confirm it is what actually appears rather than
  a blank region or a crash.
- `/property/<any-old-slug>` 404s rather than erroring.
- The standing bar still applies: **Vitest + `03-listing-journey.spec.ts`**, both against a
  production build. Note that the journey spec CREATES its own listing, so running it after
  the clear leaves the database non-empty again unless its cleanup completes — run it, then
  re-confirm the count is zero.

### Standing rules that will bite this phase specifically

- **Migrations and data changes go through the Supabase MCP at the owner's OK, or not at
  all.** There is no service-role key by policy and no automated purge — that is a settled
  decision from 2026-08-03, not an obstacle to route around.
- **Never scope a delete by status alone.** The rule was written for `zz-` test rows, and it
  matters more here, not less: this phase deletes real rows, so every statement should name
  exactly what it targets and be counted before and after.
- **Commits go straight to `main`. NEVER push without asking.**
- Playwright needs `npm run build` first and takes port 3000; stop any preview.
- `npm`/`npx` run from `dascout/web`; `git` runs from `dascout`.

### Before you start

- **Acknowledge or clear `REVIEW-PENDING.md`** at the repo root — run
  `do-me-2026-08-08-phased`, terminal state `done-green`. A new autonomous run must not
  start over an unacknowledged marker.
- The working tree is clean and everything is pushed.

### Three things left open elsewhere, none blocking Phase E

- Should the description editor offer links? Phase C shipped without them. Adding them means
  adding `a` to the sanitiser **with an href scheme allowlist**, never just to the tag list.
- The band's kicker wraps to two lines between ~748 and ~890 px of viewport. Cosmetic, left
  exactly as approved; the one-number fix is recorded in `docs/BACKLOG.md`.
- `D:\Workspace\DaScout\CLAUDE.md` carries Phase D's rule correction but lives above the
  repository root, so it is in no commit and will not travel with a clone.
