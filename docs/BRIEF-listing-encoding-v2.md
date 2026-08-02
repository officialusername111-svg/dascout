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

## 9. The one consequence that reaches the public site

Everything else in this brief is admin-side. Replacing `listing_category` is not: the public
browse-by-category navigation, the `?loc=` / `?az=` query handling, and the sitemap all read it.

Two shapes, and the owner has not yet chosen:
- **Dynamic** — the public categories become whatever rows exist in the Property Type table. Adding
  a type adds a public category. Most flexible, largest blast radius.
- **Split** — the five public categories stay fixed; Property Type is a finer admin-side
  classification that sits alongside them. Smaller change, but then it is not truly a replacement.
