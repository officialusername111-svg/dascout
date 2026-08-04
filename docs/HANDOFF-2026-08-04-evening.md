# Handoff — DaScout, 2026-08-04 evening (listing encoding v2: DONE, apply 3 live)

**Paths in this document are repo-relative. Prefix them with `dascout/` from the workspace root**
(`D:\Workspace\DaScout`), which is a workspace container, not the repo. The rule lives in
`D:\Workspace\DaScout\CLAUDE.md` and loads automatically.

Supersedes `docs/HANDOFF-2026-08-04.md` and every earlier handoff.

- **HEAD:** `942c566` on `main`, pushed and live on `origin/main`. Working tree clean except
  Playwright's own `test-results/` artifacts (untracked, gitignored-worthy, not committed).
- **Live site:** `dascoutprime.com` is running this commit. Verified directly in-browser:
  home page, `?cat=rlot`/`?cat=farm` filters, and a property detail page all render correctly
  with zero console errors, response headers confirm fresh (non-cached) server renders.
- **Database:** apply 3 of listing encoding v2 is **applied and live** on production Supabase.
  `listings.category` is gone. `listings.property_type_id` is `NOT NULL`. Confirmed by direct
  query, not by trusting this description.
- **Tests:** Vitest **453/453**, Playwright `03-listing-journey.spec.ts` **19/19**, both run
  against a full production build and real Supabase, against the now-migrated schema.

---

## 1. Listing encoding v2 is COMPLETE for its schema/core-flow scope

Pieces 1–3 and apply 1/1b/2/3 are all live. `listings.category` no longer exists.
`property_type_id` is required. The public site's `?cat=` system, the admin encoding form's
chip picker, and the email match-alert engine all read the property type through
`property_types` — none of them touch a `category` column any more, because there isn't one.

**What actually shipped this session (two commits):**

- `11847cd` — the code cutover (public `web/lib/queries.ts`, admin `web/lib/admin/queries.ts`,
  `web/lib/match-alerts.ts`, `web/lib/categories.ts`'s doc comment) plus both migrations:
  - `20260804110000_property_types_grant_anon_legacy_category.sql` — a pure grant widening
    (anon gets SELECT on `property_types.legacy_category`), applied first and separately,
    because the public site's new code needs it and it didn't exist. Deploying the code
    without this first would have 500'd the whole public site — same shape as the
    2026-08-02 outage, inverted. **Applied and verified before the code went live.**
  - `20260804120000_listing_encoding_v2_apply3.sql` — the actual narrowing migration: drops
    the now-dead `sync_listing_property_type()` trigger and `legacy_category_of()` function,
    sets `property_type_id` `NOT NULL`, drops `listings.category` and its two CHECK
    constraints and index. **Applied only after the code was pushed and confirmed live** —
    the correct order this time (code first, then the drop), which is the reverse of what
    caused the Aug 2 outage.
- `942c566` — test-only fixes found during final verification (see §3).

**Deploy sequence actually followed, in order, each step confirmed before the next:**
grant migration applied → code committed → pushed → live site verified in-browser → full
Vitest + `03-listing-journey.spec.ts` re-run green against the migrated schema → narrowing
migration applied → schema re-verified directly → advisors checked (nothing new) → full
Vitest + journey spec run a THIRD time, fully green → one more test-only commit for gaps
found along the way → pushed.

---

## 2. The grant-widening discovery — worth knowing if this pattern recurs

Before writing any code, a direct query found anon already had SELECT on
`listings.property_type_id` and `listings.frontage` (granted ahead of need back in apply 1),
but **not** on `property_types.legacy_category` — the join key the public `?cat=` filter now
needs. Apply 1's own test file even asserted the refusal as correct ("does not let anon read
legacy_category, the transition scaffolding") — right when written, wrong the moment a public
join needs the column. This is now flipped to assert the grant instead.

The lesson for any future column/table cutover: **check what the NEW code's query actually
selects, then check anon's grants on every column in that select — not just the ones that
changed.** A join can quietly need a grant nobody thought to widen.

---

## 3. Two classes of pre-existing test debt found in passing, NOT part of this migration

Both fixed already or flagged — nothing here blocks anything, listed for awareness:

- **Piece 3's action-bar redesign (dd0f565) only updated `03-listing-journey.spec.ts`.**
  Two follow-up passes (both already completed by spawned background sessions this
  session, verified in the diff before being included in `942c566`):
  1. The chip-picker/button-text selector layer (`#lf-category` → `.typechip`, "Create
     draft" → "Create listing") across `02-create-validation.spec.ts`,
     `04-sold-path.spec.ts`, `14-match-alerts-and-panels.spec.ts`.
  2. The deeper primary-vs-secondary transition-confirmation layer (LifecyclePanel only
     mounts for a secondary move behind "Status ▾"; a primary move confirms via the
     `.pill` badge instead) across `01-auth-and-noindex.spec.ts`, `04-sold-path.spec.ts`,
     `14-match-alerts-and-panels.spec.ts` again.
- **Full-suite E2E account-spec interference — flagged, NOT fixed.** Running the entire
  Playwright suite end-to-end (not just the journey spec) fails several account specs
  (`07-account-auth`, `09-account-favorites-merge`, `10-account-history`,
  `11-account-password`, `15-admin-requests`'s buyer test) with "Invalid login
  credentials" for the shared `TEST_BUYER` account. Working theory: the password-change
  test doesn't reliably restore the original password for specs that run after it in the
  same full pass. **Unrelated to listing encoding v2** — none of these specs touch
  listings/property_types/category. This is why the project's standing verification bar
  has always been "Vitest + the journey spec," not the full E2E battery — that bar is met
  and green; the full-battery fragility is a separate, now-flagged concern.

---

## 4. Still open — same list as before, apply 3 crossed off

| # | Item | Blocked on |
|---|---|---|
| 1 | ~~Apply 3 of listing encoding v2~~ | **DONE, this session** |
| 2 | Piece 4 — approval-workflow refinement | not started |
| 3 | Piece 5 — photos section redesign with icons | not started; brief says sample first |
| 4 | Piece 6 — custom loading indicator | not started; brief says diagnose the freeze before styling it |
| 5 | Piece 7 — remove the request-property function | not started; `property_requests.category` still blocks retiring `listing_category`, left deliberately |
| 6 | `cleanup_backup` schema still in Supabase | `drop schema cleanup_backup cascade;` when satisfied |
| 7 | Migration ledger drift (timestamps self-assigned) | harmless via API; would confuse `db push`/`db reset` |
| 8 | Bulk actions from the mockup | owner's call, unbuilt on purpose |
| 9 | Full-suite E2E account-spec interference (§3) | flagged as a background task, not started |

**Settled, do not reopen:** the public `?cat=` category system stays fixed at the five
seeded types ("Split" per the brief's §9, not "Dynamic") — a type added later has no
`legacy_category` and is publicly visible but not reachable via `?cat=` or nav groups. This
was already true before apply 3 and does not change. `web/lib/categories.ts`'s
`DbCategory`/`CategoryKey` system is NOT simplified away — it's still the live mechanism for
that fixed public taxonomy, just sourced through a join now instead of a raw column.

---

## Next-session prompt

```
Continue DaScout work. Read the memory index first
(C:\Users\USER\.claude\projects\D--Workspace-DaScout\memory\MEMORY.md), then this handoff
(dascout/docs/HANDOFF-2026-08-04-evening.md) for the detail.

Listing encoding v2 is done — apply 3 landed and is live (commit 11847cd + 942c566, both
pushed). Nothing from that brief is blocking anything else now except piece 7 (remove
request-property function), which is still deliberately deferred.

Two follow-up chips are pending from this session (may already show as available in the
UI): a full-suite E2E interference fix (task_3f5515f1, account specs), unrelated to listing
encoding v2. Neither blocks anything.

Ask the owner which is next: piece 4 (approval workflow), piece 5 (photos redesign, sample
first), piece 6 (loading indicator, diagnose first), piece 7, or something else entirely —
or route through /do-me if they just say "continue."
```

Related memory: [[dascout-listing-v2-piece3-done]], [[dascout-app-buildout]],
[[dascout-workflow-prefs]], [[dascout-deployment]]
