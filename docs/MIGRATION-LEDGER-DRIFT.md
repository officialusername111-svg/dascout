# Migration ledger drift — repo files vs. live `schema_migrations`

**Date audited:** 2026-07-31
**Verdict:** the drift is hygiene, not a defect. 8 of the 10 drifted files differ from the live
ledger by comments and whitespace only. The other 2 differ by one extra statement each in the
ledger — both harmless (one is superseded by a later migration in the repo chain, one is a
one-time test-data delete that is a no-op on a fresh database). The live end-state (30 public +
8 storage policies, function/table grants) was independently verified on 2026-07-31 to be
identical to what the repo chain produces. Nothing needs to change on the live database.

## How the comparison was done

Each row of `supabase_migrations.schema_migrations` stores the applied SQL in `statements[1]`.
Every drifted statement was fetched base64-encoded, decoded locally, and its MD5 re-verified
against `md5(statements[1])` computed server-side, so the diffs below are against byte-faithful
copies. Repo files were normalized CRLF→LF with trailing whitespace trimmed before diffing
(the ledger stores statements with no trailing newline; that difference is ignored throughout).

## Why the drift exists

The six Phase-0 files (`20260727*`) were exported verbatim **from** the ledger (commit
`dc9e602`), so they match exactly. The later migrations were applied **to** the live project via
the Supabase MCP `apply_migration` tool, which stamps the version with the apply-time timestamp
rather than the repo filename's. Seven files were restamped this way. Separately, the SQL text
sent at apply time and the text committed to the repo were edited independently — mostly
comment enrichment on the repo side after applying — which is what breaks the MD5s.

## File-by-file classification

Ledger versions marked ✱ were restamped at apply time (filename timestamp ≠ ledger version).
Relative apply order matches repo filename order for all 19 migrations, so replay order is
unaffected.

| Repo file | Ledger version | Difference |
|---|---|---|
| `20260729130349_throttle_listing_views.sql` | `20260729130349` | Comments only — the **ledger** carries three explanatory comment blocks the repo file lacks |
| `20260729130410_harden_property_requests.sql` | `20260729130410` | **Substantive** — see below |
| `20260729130844_restrict_is_staff_execute.sql` | `20260729130844` | **Substantive** — see below |
| `20260729140000_add_draft_photo_bucket.sql` | `20260729233235` ✱ | Comments only — repo has explanatory blocks and an inline `-- 10 MB` note the ledger lacks |
| `20260729140100_add_publish_guard_trigger.sql` | `20260729233249` ✱ | Comments only — repo has extensive panel-hardening commentary the ledger lacks |
| `20260729140200_tighten_verification_events_policies.sql` | `20260729233300` ✱ | Comments only — same pattern |
| `20260729140300_add_reorder_photos_function.sql` | `20260730023305` ✱ | Comments only — same pattern |
| `20260730060000_listing_views_buyer_history.sql` | `20260730070812` ✱ | Comments only — same pattern |
| `20260730060100_listing_views_detach_column_grant.sql` | `20260730095404` ✱ | Comments only — same pattern |
| `20260730060300_clear_history_definer.sql` | `20260730144127` ✱ | Comments only — same pattern |

Matching files, for completeness: the six `20260727*` Phase-0 files (verbatim ledger exports),
plus `20260729130330_harden_anon_surface_and_storage.sql`,
`20260729131011_restrict_throttle_function_execute.sql`, and
`20260731070000_phase5_requests_notifications.sql` (ledger `20260730230201`, content-identical).

## The two substantive differences

### 1. `harden_property_requests` — ledger has an extra REVOKE

The ledger statement contains one line the repo file does not:

```sql
revoke execute on function public.throttle_property_requests() from anon, authenticated;
```

**Impact: none.** The repo chain's next-but-one migration,
`20260729131011_restrict_throttle_function_execute.sql` (which DOES match its ledger entry),
revokes EXECUTE on the same function from `public`, `anon`, and `authenticated` — a strict
superset. Replaying the repo chain on a fresh database converges to the same grants; the only
difference is that the function is briefly executable by `anon`/`authenticated` between two
migrations inside the same replay run.

### 2. `restrict_is_staff_execute` — ledger has an extra one-time DELETE

The ledger statement ends with a cleanup the repo file omits:

```sql
-- Clear the rows left by the throttle check.
delete from public.property_requests
 where email in ('throttle-test@example.com', 'len-test@example.com');
```

**Impact: none.** This deleted two test rows created while live-testing the request throttle.
It is data-only (no schema effect), and on a fresh database those rows never exist, so the
repo's omission changes nothing. Deliberately not back-ported: a one-time production cleanup
does not belong in a replayable migration.

## Operational caveat

Because seven filename timestamps differ from their ledger versions, the Supabase CLI
(`supabase migration list` / `db push`) would see those seven repo files as *unapplied* and the
seven ledger versions as *missing locally*. The MCP `apply_migration` workflow used so far does
not care, but if the CLI workflow is ever adopted, run `supabase migration repair` (or rename
the files as below) first — do **not** let `db push` re-apply them.

## Recommended reconciliation (proposed, not executed)

1. **Rename the seven restamped files to their ledger versions** (e.g.
   `20260729140000_add_draft_photo_bucket.sql` → `20260729233235_add_draft_photo_bucket.sql`).
   This restores filename ↔ ledger alignment with zero SQL changes and keeps replay order
   (which already matches) explicit.
2. **Keep the repo SQL text as-is.** The repo copies carry substantially richer commentary than
   what was applied; overwriting them with verbatim ledger exports (the Phase-0 approach) would
   destroy documentation for no behavioural gain. Accept that MD5s intentionally differ, with
   this file as the record of why.
3. **Do not modify the live ledger.** Rewriting `schema_migrations.statements` to match the repo
   would be a live-database write with no functional benefit.

Alternative, if byte-exact repo ↔ ledger parity is preferred over the commentary: replace the
ten files with verbatim ledger exports (same treatment as Phase 0, commit `dc9e602`), moving the
rich comments into a companion doc. Not recommended — the comments are the more valuable artifact.
