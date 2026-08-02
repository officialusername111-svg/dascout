# BRIEF — listing encoding v2

Paths in this document are repo-relative; prefix with `dascout/` from the workspace root.

Captured from the owner on 2026-08-02. **Not built.** This is the spec, not a plan — it is written
down so it survives the conversation it was given in. Open questions are listed at the end and must
be answered before piece 1 starts.

## The shape of it

The owner is replacing **verification** with **approval** across the product. Verification records
go away entirely; a "For Approval" status arrives, mirroring the admin-account approval queue built
in `run-p9-invite-approval-queue`. Naming that makes the rest of this brief easier to read.

## 1. Listing fields

**Add:**

| Field | Notes |
|---|---|
| **Property Type (Zoning Classification)** | Encoded — needs its own lookup table and CRUD screen |
| **Property Location** | Replaces "Barangay or area". Encoded — lookup table + CRUD ("Town") |
| **Frontage** | New field |

**Add three features:**
1. All documents Verified
2. Updated Tax Declaration
3. Direct Owner

**Remove:**
1. **Verification record** — the whole concept
2. **Status and publishing** — off the encoding form entirely (see §3)

## 2. The encoding flow — three steps, not four

A stepper or a set of collapsibles:

1. **Listing details** → save
2. **Features** → save
3. **Photos** → save

After step 3 the listing lands in **List**. There is no publishing step inside encoding — that is
the point of removing "status and publishing" from the form. Status changes happen from the listings
index afterwards.

## 3. Status lifecycle

| Status | Meaning |
|---|---|
| **List** | Newly encoded or updated listing. The working state. |
| **For Approval** | Submitted and waiting for a decision |
| **Live** | Approved and public |
| **Sold** | Triggered from Live |
| **Withdrawn** | Hidden |

**Transitions, decided by the owner 2026-08-02:**

- **List → For Approval:** the **encoder submits it**. Explicit action, not automatic. A listing can
  be edited freely while it sits in List.
- **For Approval → Live:** **any listing admin** may approve, **including their own work**. The
  owner was shown that this makes approval a button the same person can press twice rather than a
  second pair of eyes, and chose it deliberately. **Do not re-litigate this.**
- **Live → Sold:** triggered from Live.
- **→ Withdrawn:** hides the listing.

Current enum is `draft | verifying | live | sold | withdrawn`. This is largely `draft → List` and
`verifying → For Approval`, plus the semantic shift from verification to approval. Postgres enum
labels cannot be dropped, but `alter type … rename value` exists in PG10+ — verify before relying on it.

## 4. New CRUD screens

Add / edit for:
1. Property type
2. Town
3. Features

## 5. Other

- **Remove the request-property function.** The UI was already removed in the v6 home redesign and
  the data layer kept; this removes the function too.
- **Photos section — redesign with icons** (`/redesign-me`). Needs a sample before building.
- **Custom loading indicator with the DaScout logo.** The reported symptom is that the whole page
  freezes and then blinks. **Diagnose the freeze before styling it** — a spinner over a blocking
  render hides the problem rather than fixing it.

## 6. Why this reduces the test burden in one specific place

`verification_events` has RLS enabled with **zero delete-capable policies** and is the only
`RESTRICT` foreign key on `listings`. That combination is exactly what makes test fixtures
permanently undeletable and produces the `zz-` residue — roughly three rows per full Vitest run.

Removing verification records removes that constraint. Four test files are affected:
`verification-events`, `publish-guard-trigger`, `reorder-photos-rpc`,
`account-listing-views-rls`.

**Everything else in this brief increases the test count.** The net is not a saving.

## 7. Suggested sequence

Piece 1 must land before 2, 3 and 4 — they all read from it.

| # | Piece | Size | Gate |
|---|---|---|---|
| 1 | Schema: lookups, frontage, three features, status rename, drop verification | **Large** | migration → owner applies |
| 2 | Three CRUD screens | Medium | |
| 3 | The 3-step encoding flow | Medium | **sample first** |
| 4 | Listing approval workflow (submit → approve) | Medium | |
| 5 | Photos redesign | Medium | **sample first** |
| 6 | Loading indicator | Small | **diagnose first**, then sample |
| 7 | Remove request-property function | Small | |

## 8. Answered by the owner, 2026-08-02

1. **Property Type REPLACES the existing category.** The `listing_category` enum
   (`residential_lot`, `farm_land`, `commercial_lot`, `residential_building`,
   `commercial_building`) gives way to an encoded, owner-editable lookup table.
   **Consequence to design around:** the public site's five browse categories are built on that
   enum. Replacing it with an editable table makes the public category structure dynamic. See §9.
2. **Property Location is a rename** of Barangay/area, made encoded so new locations can be added.
   One level, managed through the "Town" CRUD screen.
3. **Frontage is free text.** No unit enforced, no numeric validation.
4. **The three new features ADD to the existing set.** Nothing existing is removed.
5. **Drop the `verification_events` table.** Not a UI removal — the table goes.
   - **This destroys no real data:** the 12 real listings have zero verification events; all 166 that
     ever existed belonged to test fixtures and were swept on 2026-08-02.
   - **It closes the `zz-` residue problem permanently** — that table's RLS + RESTRICT FK is the
     entire cause.
   - **It requires reworking the publish guard.** `verification_kind` includes `published`, so
     publishing currently writes an event and `guard_listing_publish` depends on it. That guard must
     be redesigned or removed as part of the same migration, not discovered afterwards.

## 8b. Design decisions from discovery (2026-08-03) — READ BEFORE BUILDING

A blast-radius analysis and a schema design were run against the real code. Both are recorded here
because they changed the plan materially. **Where this section disagrees with §1–§9 above, this
section wins** — §1–§9 is what the owner asked for, this is what the code says it costs.

### D1 — Only TWO status labels change. This is the single biggest risk reduction available.

`Live`, `Sold` and `Withdrawn` differ from the stored `live`, `sold`, `withdrawn` **only by
capitalisation**, and `STATUS_LABELS` (`web/lib/admin/queries.ts:43-49`) already renders `live` as
"Live". **Keep those three stored labels unchanged.** Then eleven RLS policies, `top_listings()`,
`sync_listing_timestamps()`, all seven `.eq('status','live')` calls in `lib/queries.ts`,
`app/sitemap.ts`, `lib/match-alerts.ts` and four E2E specs **never enter the blast radius.**

Only `draft → list` and `verifying → for_approval` are real renames, and **zero production rows are
affected** — all 12 listings are `live`.

### D2 — Store machine labels, display the owner's strings.

The enum carries `list` and `for_approval`, **not** `List` and `For Approval`. A label with a space
and capitals ends up in query strings (`?status=For+Approval`), PostgREST filters
(`status=eq.For%20Approval`) and every test fixture. Every other enum in this schema is lowercase
snake. The screen reads "For Approval" either way, via the existing label map. **Costs the owner
nothing.**

### D3 — Property Location: OWNER DECIDED 2026-08-03.

**`towns` gets an add/edit screen. `area_detail` (barangay) stays FREE TEXT and is relabelled
"Property Location".**

This is the cheapest correct answer and it removes the worst risk in the whole piece: `area_detail`
feeds the `search_vector` generated column, so converting it to a lookup would have forced dropping
and rebuilding that column **and** its GIN index — a full rewrite of the listings table.

**Consequence: `area_detail` needs no schema change at all.** It is a UI relabel. `towns` already is
the encoded lookup the brief asked for — unique slug, public-read policy, `on delete restrict` FK,
8 rows — and was only ever missing a CRUD screen.

### D4 — `property_requests.category` blocks retiring the enum, and the brief never mentions it.

It is the **second** column typed `listing_category`. Postgres will not drop the type while it
exists. Either piece 7 (remove the request-property function) moves **ahead** of piece 1, or the
enum simply survives this run unused by `listings` — which is the safest state available and the
recommended one.

### D5 — Three applies, not one migration.

| Apply | Contents | What breaks in between |
|---|---|---|
| **1** | `property_types` + RLS + grants, `listings.property_type_id` (nullable) + `frontage`, `property_requests.wanted_property_type_id`, `towns.is_active`, 3 features, backfill + assertions | **Nothing.** Purely additive; grants only widen. Deploy code afterwards. |
| **2** | Status rename ×2, `guard_listing_publish` replaced, `verification_events` dropped | **Admin only** — listing creation, status tabs, transitions, the detail page. **Public site untouched.** Code must deploy within minutes; schedule outside working hours. |
| **3** | `property_type_id` set NOT NULL, drop `listings.category` | Nothing if ordered right. **This is the point of no return.** |

Apply 3 is deliberately a later release: until it runs, `listings.category` is still populated and
correct, so the entire change is revertible by reverting the code.

### D6 — `guard_listing_publish` is REDESIGNED, not removed.

It does four things; two have nothing to do with verification and must survive (refusing an INSERT
straight into a public status, and refusing `→ sold` except from `live`).

**Removing the events requirement without replacing it removes the only database-side thing stopping
a direct PostgREST call flipping a listing from `list` to `live`, skipping approval entirely.**
Staff RLS on `listings` is `FOR ALL` and the transition graph lives in TypeScript. The guard must
gain the transition matrix, or approval becomes a UI convention.

**The detail that will take the admin down if missed:** the trigger is `before insert or update of
status`, so it fires on any UPDATE whose SET list mentions status — **including when the value is
unchanged**. The matrix must permit `old.status = new.status` and return early, or every ordinary
form save raises.

### D7 — The three ways this change has the 2026-08-02 outage shape

`category`, `area_detail` and `frontage` are all named individually in the anon column grant
(`20260802160000`). Table-level SELECT was revoked, so a mismatch fails **closed** — every public
query returns 42501 and the site goes dark. D3 removes one of the three. The remaining rule:
**grants that widen may land before the code; anything that narrows must land after it.**

### D8 — Two live bugs found in passing, neither in the brief

- **The public feature filter keys on `features.name`, not `slug`** (`web/lib/queries.ts:204`).
  The moment the features CRUD screen ships, renaming a feature silently returns zero results for
  every saved `?feat=` link. **Must move to slug in the same deploy as the features CRUD.**
- **`listing_features.feature_id` is `ON DELETE CASCADE`.** With a CRUD screen, deleting a feature
  silently strips it from every listing, no warning, no undo. Should become `RESTRICT`.

### D9 — Corrections to §9 above (my errors, not the owner's)

- **The sitemap does not read the category.** It selects `slug, updated_at` filtered by status. It is
  exposed to the *status* change, not the category change.
- **There is no `?az=` parameter anywhere in the codebase.** The accepted keys are `cat`, `loc`,
  `size`, `feat`, `tab`, `page`. The phrase was carried over from an old handoff without checking.

### D10 — Named, not fixed

- **`withdrawn → live` skips approval** — in the old graph and the new one. Withdraw, edit freely,
  relist, and it is public without passing For Approval. The owner's table says Withdrawn merely
  hides, so the edge stays. It is the one way around the approval gate.
- **Adding a sixth property type will not appear in the "Lots"/"Buildings" nav groups** — those are
  literal slug lists. The browse page will show it; the nav dropdown will not.
- **"All Documents Verified" is added as a feature in the run that deletes verification**, and
  "Title-verified by DaScout" remains in public page metadata, the home page VerifiedBand, and the
  alert emails. Not a contradiction — a paperwork claim is not a workflow — but worth one sentence
  in the migration header so a later reader does not think the removal was incomplete.
- **Seed the five property-type slugs as the existing URL keys** (`rlot`, `farm`, `clot`, `rbdg`,
  `cbdg`), not the enum values. Every existing `?cat=rlot` link keeps working with no redirect logic.
- **Seed names exactly as displayed today**, abbreviations included (`Residential Bldg`). Nothing on
  screen changes on migration day; the owner renames afterwards, which is the point of the table.

### Still open — answer before apply 1

| # | Question | Blocks |
|---|---|---|
| O2 | Does `→ Withdrawn` come from any status, or only from Live as today? | the transition matrix |
| O3 | Is `frontage` shown publicly, or admin-only? | apply 1's anon column grant |
| O4 | Nav groups: keep as literal lists, retire, or add a `group_key` column? | the browse nav |
| O5 | Are the `listing_features` FK tightening and `features.sort_order`/`is_active` in apply 1, or a separate piece? | apply 1 scope |

## 9. The one consequence that reaches the public site

Everything else in this brief is admin-side. Replacing `listing_category` is not: the public
browse-by-category navigation, the `?loc=` / `?az=` query handling, and the sitemap all read it.

Two shapes, and the owner has not yet chosen:
- **Dynamic** — the public categories become whatever rows exist in the Property Type table. Adding
  a type adds a public category. Most flexible, largest blast radius.
- **Split** — the five public categories stay fixed; Property Type is a finer admin-side
  classification that sits alongside them. Smaller change, but then it is not truly a replacement.
