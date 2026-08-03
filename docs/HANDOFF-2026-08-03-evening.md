# Handoff — DaScout, 2026-08-03 evening (listing encoding v2: apply 2 + piece 2 LIVE)

**Paths in this document are repo-relative. Prefix them with `dascout/` from the workspace root**
(`D:\Workspace\DaScout`), which is a workspace container, not the repo. The rule lives in
`D:\Workspace\DaScout\CLAUDE.md` and loads automatically.

Supersedes `docs/HANDOFF-2026-08-03.md` and `docs/HANDOFF-2026-08-03-live.md`, and every earlier
handoff.

- **HEAD:** `d70b689` on `main`, **level with `origin/main`**. Working tree **clean**.
- **Tests:** Vitest **456 passed / 25 files — 0 failed, 0 skipped** (was 368 this morning; +88 new)
- **Live:** <https://dascoutprime.com> — public site confirmed healthy after both deploys today
  (home, sitemap, category filter all 200, no console errors)
- **Database:** 12 real listings, all `live`, **0 `zz-` residue** right now, `verification_events`
  table **gone**, `/admin/settings` live with 5 property types / 8 towns / 35 features

---

## 1. Two things shipped today, both reviewed and confirmed before going out

### Apply 2 of listing encoding v2 — `29e8f3b`

- Renamed exactly two `listing_status` enum values: `draft → list`, `verifying → for_approval`.
  `live` / `sold` / `withdrawn` untouched on purpose — that's what kept the public site, 11 RLS
  policies, the sitemap and four E2E specs out of the blast radius.
- `guard_listing_publish` rewritten from an events-count check to an explicit transition-matrix
  trigger, ported from the app's own `TRANSITIONS` map in `lib/admin/queries.ts` — with an early
  return for `old.status = new.status`, because the trigger fires on every ordinary form save and
  would otherwise raise on a no-op.
- `verification_events` table dropped — its `RESTRICT` FK was the root cause of permanently
  undeletable test fixtures since July. The one real row in it (a `title_check` on property 012,
  "Villa Consuelo Modern Home") was carried forward first: property 012 now carries the
  "All documents Verified" feature instead of a workflow record nothing read.
- A discovery correction worth knowing: the blast radius was bigger than the brief implied.
  `verification_events` was read by a whole admin feature — a logging form, a checklist, an
  event-history reader — not just the DB guard. All of it was removed end to end, not just renamed.
- One production surprise: `verification_kind` (the enum) could **not** be dropped — a leftover
  backup table (`cleanup_backup.verification_events_20260801`, already a tracked open item) still
  references it. Left in place deliberately, same precedent as leaving `listing_category` unused in
  apply 1b. Revisit when `cleanup_backup` is finally dropped.

### Piece 2 of listing encoding v2 — `d70b689`

- `/admin/settings` — three CRUD screens (Property Types, Towns, Features), all staff can reach it
  (not super-admin gated). **Built to a visual sample approved in chat before any code was written**
  — per the standing sample-and-approve rule for UI work.
- Every delete is refused three ways: a disabled button when a row is in use, a server-side count
  check, and the underlying FK. The five seeded property types can only be set Inactive, never
  deleted — each carries a `legacy_category` the old encoding form's sync trigger still depends on.
  Slugs are create-only on all three lists (omitted from every update schema, not just disabled in
  the UI).
- Bundled per the brief's own requirement: the public `?feat=` filter and `getPopularFeatures()` now
  match by **slug**, not name, and `Sidebar` links with the slug while showing the name. Without
  this, the moment a feature could be renamed (which this screen enables), every saved `?feat=` link
  would have silently broken.
- **A discovery correction to the brief itself:** `listing_features.feature_id` was already
  `ON DELETE RESTRICT` on production, confirmed directly against `pg_constraint` — not `CASCADE` as
  the brief's own §D8 note claimed. That note predated apply 1's fix and was never updated. A
  defensive migration was written, found to be a no-op, and deleted rather than committed.

---

## 2. A claim I made mid-session and then corrected

I told the owner apply 3 was unblocked once piece 2 shipped. **That was wrong**, and I said so as
soon as I checked: piece 2 only lets staff manage the *lookup lists*. It never touched
`web/components/admin/ListingForm.tsx` — the actual per-listing encoding form, which still has only
the old fixed 5-option `category` select. Apply 3 (drop `listings.category`, make `property_type_id`
NOT NULL) is **still blocked** on that form gaining a property-type picker, which is piece 3's job.

**Do not start apply 3 next session without piece 3 landing first.**

---

## 3. Still open

| # | Item | Blocked on |
|---|---|---|
| 1 | **Piece 3** — the 3-step encoding flow, incl. swapping `ListingForm.tsx`'s category picker for a property-type picker | next session; needs a sample first, same as piece 2 |
| 2 | Apply 3 of listing encoding v2 (drop `category`, NOT NULL `property_type_id`) | piece 3 landing |
| 3 | Piece 4 — approval-workflow refinement | not started |
| 4 | Piece 5 — photos section redesign with icons | not started; brief says sample first |
| 5 | Piece 6 — custom loading indicator | not started; brief says diagnose the freeze before styling it |
| 6 | Piece 7 — remove the request-property function | not started; `property_requests.category` still blocks retiring `listing_category`, left deliberately |
| 7 | `cleanup_backup` schema still in Supabase | `drop schema cleanup_backup cascade;` when satisfied — also what's blocking `verification_kind`'s drop |
| 8 | Migration ledger drift (now 6 files applied via MCP, timestamps self-assigned) | harmless via API; would confuse `db push`/`db reset` |
| 9 | Bulk actions from the mockup | owner's call, unbuilt on purpose |
| 10 | Superseded handoff docs in `docs/` | consolidate or archive |

**Settled, do not reopen:** "Confirm email" is ON. Test data swept manually via Supabase MCP, no
service-role key. Price readable by any registered account. Any listing admin can approve their own
work, including the encoder's own listing. `withdrawn → live` bypasses approval, deliberately.

---

## 4. Traps that cost time today, still true

- **The two-root path trap.** Prefix repo paths with `dascout/` from the workspace root.
- **Brief documentation goes stale.** Twice today a written spec (the blast-radius estimate, the
  features FK's supposed CASCADE) turned out to be wrong against the live schema. Verify against
  `pg_constraint` / a real grep before building on a brief's claim, even one written carefully.
- **A migration that narrows must ship with its code, not before or long after.** Apply 2's guard
  rewrite and the app code had to land within minutes of each other — the live site briefly can't
  create listings correctly if only one side has shipped.
- **`property_types.icon` is a closed sprite-symbol set**, not free text — check
  `components/Icon.tsx` and the layout's sprite before adding a new icon option anywhere.
- **`group_key` stores `lots`/`bldgs`/NULL, never the display words** "Lots"/"Buildings".
- **A full Vitest run leaves `zz-` residue** — currently 0, swept clean this session, but check
  before assuming.
- **`web/AGENTS.md` is real.** Next.js **16.2.12**, not the Next in your training data.
- **Never run `npm audit fix --force`** — it downgrades Next to 9.3.3.

---

## Next-session prompt

```
Continue DaScout listing-encoding-v2 work. Read the memory index first
(C:\Users\USER\.claude\projects\D--Workspace-DaScout\memory\MEMORY.md), then this handoff
(dascout/docs/HANDOFF-2026-08-03-evening.md) for the detail.

Apply 2 and piece 2 are live on main (d70b689). Next up is piece 3: the 3-step encoding
flow redesign from docs/BRIEF-listing-encoding-v2.md §2, which includes swapping
ListingForm.tsx's old 5-option category picker for a property-type picker sourced from
the now-live /admin/settings screens. This is the actual blocker for apply 3 (dropping
listings.category) — do not start apply 3 before piece 3 lands.

This is a UI change to an existing form, so per the standing global rule: present a
sample/mockup first and get it approved before writing any code, same as piece 2 did.
Verify current schema/code state directly (pg_constraint, grep) rather than trusting
brief text alone — two of the brief's own claims turned out stale this session.
```

Related memory: [[dascout-listing-v2-piece2-done]], [[dascout-app-buildout]],
[[dascout-e2e-writes-to-prod]], [[dascout-workflow-prefs]]
