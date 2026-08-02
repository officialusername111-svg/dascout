# Handoff — DaScout, evening of 2026-08-02

Supersedes `docs/HANDOFF-2026-08-02.md`, which was written earlier the same day. Where the two
disagree, this one is right — several of that file's open items are now closed, and **one of its
instructions is actively dangerous** (see "Things that will bite you").

- **HEAD:** `25c4124` on `main`, **2 commits AHEAD of `origin/main`** — the admin redesign and the
  property-number-in-title change are committed and **not deployed**
- **Working tree:** clean apart from `docs/NEXT-SESSION-PROMPT.md`, which is untracked on purpose
- **Tests:** Vitest **277 / 277** across 18 files. Playwright: the two targeted specs
  (`06-public-smoke`, `18-admin-redesign`) run **9 / 9**; the full suite was not run
- **Live:** <https://dascoutprime.com> healthy (home 200, sitemap 200), serving `12b6131`
- **Database:** 23 migrations applied. 78 listings, of which **66 are `zz-` test rows**

---

## ⚠️ Read this first

**Paths in this document are repo-relative. Prefix them with `dascout/` from the workspace root.**

The git repo is `D:\Workspace\DaScout\dascout`, one level BELOW the working directory
`D:\Workspace\DaScout`. So `web/.env.local` below means `dascout/web/.env.local` when you pass it
to a tool. Three sessions in a row lost their opening tool calls to this, because each handoff
carried a *warning* about the trap instead of a rule for converting the paths — the warning was
treated as the fix. The standing rule now lives in `D:\Workspace\DaScout\CLAUDE.md`, which loads
automatically every session.

**Status of the two unpushed commits: PUSHED and live** as of 2026-08-02 (`12b6131..d3273a0`,
which also carried this document). The admin redesign and the property-number change are on
dascoutprime.com. The sections below were written before that push — read them as the record of
what was built, not as a description of what is still pending.

---

## What happened this session

**1. The price exposure is closed for anonymous callers.** `12b6131`, live.

`anon` held table-level SELECT on `public.listings`, so every column — including `price_php` — was
readable over PostgREST by anyone holding the publishable key, which ships in the public JavaScript
bundle. The "no peso amounts public" rule was enforced only by the app never asking for the column.

The owner chose option 1 of the three: `getSpotlightListings` no longer orders by `price_php` (it
orders by `published_at desc, created_at desc`, which is also the better hero rule), and
`20260802160000` revokes ALL of anon's privileges on `listings` and grants back SELECT on 17 named
columns. `broker_id`, `created_by`, `sold_at` and `search_vector` are closed by the same change, and
so are anon's INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/TRUNCATE grants — only RLS had been stopping
an anonymous write.

**The durable half:** with the table-level grant gone, a column added by a future migration is
unreadable by anon until someone grants it on purpose. That is exactly the trap that let
`property_no` inherit public SELECT the moment it was created.

**2. The admin v1 redesign is built.** `47a45e1`, committed, **not deployed**.

`docs/mockups/admin-v1-proposed.html`, built into the two listing screens. Pagination is truncated
instead of one link per page; status, search and sort are one toolbar with counts and no Apply click
(the Apply button survives inside `<noscript>`); publish blockers are chips on the row plus an
attention strip with a working "show only these" filter; and the reasons a listing cannot go live are
an itemised checklist at the top of the detail screen with the primary action in a sticky bar beside
them. "Back to listings" keeps the filter, search, sort and page it came from.

**3. The property number is public, and leads the name.** `47a45e1` + `25c4124`, **not deployed**.

`001 - Dacera Heights Corner Lot`, from one helper (`displayTitle` in `web/lib/format.ts`) on the
property page heading, its tab and OpenGraph titles, every listing card, the enquiry subject and body,
and the admin sticky bar. **Not** on the admin listings index, which has a property-number column of
its own. **Nothing shows on screen yet: 0 of 78 listings have a property number.**

**4. Housekeeping and cleanup.** `a0a98a2` + `2c9255c`, live. The `/admin/sign-in` copy no longer
claims accounts are not self-service; `supabase/types/database.types.ts` is regenerated and identical
to `web/lib/database.types.ts`; the `20260802131500` §2 comment no longer describes the unbuilt
redesign as shipped behaviour. Six merged branches and one worktree are gone, ledgered in
`CLEAN-HISTORY.md`. `REVIEW-PENDING.md` is deleted.

---

## Decisions the owner made today — do not re-litigate these

| Decision | Answer | Where it lives |
|---|---|---|
| Which price fix | Option 1: reorder the hero, then revoke | `20260802160000` |
| Revoke anon's write grants too | Yes | same migration |
| Price still readable by any registered account | **Accepted.** "We can activate the price later if client wants it." | see below |
| Property number public? | Yes, on the property page | `25c4124` |
| Property number blocks publishing? | **No** — soft checklist item only | `publishChecklistFor` |
| Property number position | Before the name: `001 - Title` | `displayTitle` |

---

## Pending, in the order I would take them

| # | Item | Blocked on |
|---|---|---|
| 1 | **Push `47a45e1` + `25c4124`** — the redesign is not live | the owner's OK |
| 2 | **66 of 78 listings are `zz-` test rows** and it grows every Playwright run | choice of durable fix |
| 3 | **Bulk actions** from the mockup — deliberately not built | the owner's call |
| 4 | **Price readable by any registered account** | accepted for now; reopen only if asked |
| 5 | **No second super admin** | one Supabase dashboard action, no code |
| 6 | Migration ledger drift — now 3 files | noted, low risk |
| 7 | `?loc=` / `?az=` edge cases | parked from the v6 run |

**On #2:** it was 48 of 60 this morning. The E2E suite writes to production and every run adds
more. Cleanup recipe — `verification_events` is the only `RESTRICT` FK, so its rows go first:

```sql
with doomed as (select id from public.listings where slug like 'zz-%')
delete from public.verification_events where listing_id in (select id from doomed);
delete from public.listings where slug like 'zz-%';
```

Durable options: a separate Supabase project, a Supabase branch, or a global-teardown in the suite.
The fixtures already self-identify by the `zz-` prefix.

**On #3:** the approved mockup shows a bulk-select bar with bulk Publish and Send-to-review. It was
not built, on purpose: publishing several listings at once past the per-listing confirm step is a new
capability on a verification gate, not a layout change, and it was outside the four defects the
redesign was scoped to. Everything else in the mockup is built.

**On #4:** `listings_public_read_live` covers `{anon, authenticated}`, and staff and buyers share the
one `authenticated` Postgres role, so no column grant can separate them — narrowing `authenticated`
would take the price away from the admin panel, which needs it. Closing it properly means moving the
price into its own staff-only table. The owner has accepted the current bar ("anyone who registers"
rather than "anyone who reads our JavaScript"). **It is a decision, not an oversight — do not
re-raise it as a finding.**

---

## Things that will bite you if you don't know them

- **A grant change and the code that depends on it MUST ship together.** Applying `20260802160000`
  while the deployed bundle still ordered the hero by `price_php` took dascoutprime.com to a **500
  for about ten minutes**. The database change is not independently deployable. This is the single
  most expensive mistake of the session and it was entirely avoidable.
- **`docs/HANDOFF-2026-08-02.md` lists 15 columns for the anon grant. That list is WRONG** — it
  omits `updated_at`, which `web/app/sitemap.ts` both selects and orders by. The applied migration
  grants 17. Use the migration, never that list.
- **`.pill` is absolutely positioned by default** (it began life as a badge on a photo card). Every
  admin surface that renders one inline must be added to the `position:static` override in
  `globals.css`. Forgetting sent every status pill to the top-left corner of the page, on top of the
  `<h1>`, in the redesign's first build.
- **`publishChecklistFor` and `publishBlockersFor` are two functions on purpose.** The checklist is
  what the screen SHOWS; the blockers are what actually STOPS a publish, and `guard_listing_publish`
  enforces the same set again in the database. The soft property-number item must never reach the
  blockers — `admin-redesign.unit.test.ts` asserts it cannot.
- **There is no Docker and no local Postgres.** Production is the only reachable database. A
  migration is applied via the Supabase MCP at the owner's ASK gate, or not at all.
- **`apply_migration` assigns its own timestamp.** `20260802160000` applied as `20260802071654`.
  Third file affected; harmless through the API, would confuse a `db push` or `db reset`.
- **The E2E suite writes to production.** Prefer targeted specs. `06-public-smoke` and
  `18-admin-redesign` are both read-only and safe to run.
- **Playwright needs `npm run build` first** and starts its own server on port 3000 with
  `reuseExistingServer: false` — stop any dev preview before running it.
- **`is_staff()` must never be redefined.** ~20 policies use it to mean "may work the listing panel".
- **No peso amounts and no map anywhere public.** Admin pages may show peso.
- **Commits go straight to `main`. Never push without asking.** Vercel deploys in ~20s.
- **Never run `npm audit fix --force`** — it downgrades Next to 9.3.3.
- **`web/AGENTS.md` is real.** Next.js **16.2.12**, not the Next in your training data. Read
  `web/node_modules/next/dist/docs/` before using any Next API.

---

## Map of the useful documents

| Document | What it is for |
|---|---|
| `supabase/migrations/20260802160000_listings_detach_anon_column_grant.sql` | the price fix, with the column derivation and a rollback block |
| `web/tests/vitest/anon-column-grants.integration.test.ts` | proves the anon API refuses `price_php`; writes nothing |
| `web/tests/vitest/admin-redesign.unit.test.ts` | the back-link allowlist, the pager window, the soft/hard checklist invariant |
| `web/tests/e2e/18-admin-redesign.spec.ts` | the redesign, read-only, including the back-link round trip |
| `docs/mockups/admin-v1-proposed.html` | the approved mockup — now built except the bulk bar |
| `CLEAN-HISTORY.md` | what the cleanup removed and how to restore it |
| `docs/agent-runs/INDEX.md` | every autonomous run with its rollback command |
| `docs/RUNBOOK-v6-deploy.md` | how to release and roll back |

Memory (`~/.claude/projects/D--Workspace-DaScout/memory/`) carries the same open items in recall
form. `dascout-price-exposed-to-anon.md` is the one to read before touching any grant.
