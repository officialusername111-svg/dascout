# DaScout — Supabase

Project: `kogpuuidawbmttyswvsx` · API URL: `https://kogpuuidawbmttyswvsx.supabase.co`

Phase 0 of [BUILD-PLAN.md](../docs/BUILD-PLAN.md) is done: the schema, security and seed data are
applied to the remote project.

## Migrations already applied

| Version | Name | What it did |
|---|---|---|
| 20260727163606 | `dascout_core_schema` | Enums, 11 tables, indexes, full-text search column |
| 20260727163635 | `dascout_functions_and_triggers` | Profile-on-signup, price-change recording, lifecycle timestamps |
| 20260727163720 | `dascout_row_level_security` | RLS enabled on every table, with policies |
| 20260727163744 | `dascout_top_listings_and_storage` | `top_listings()` RPC, `listing-photos` bucket + policies |
| 20260727164012 | `dascout_security_hardening` | Fixes for the advisor findings (see below) |
| 20260727164056 | `dascout_split_anon_policies` | Per-role read policies so `anon` loses `is_staff()` access |

**The SQL files are not in this folder yet.** They live in the remote project's migration history.
Once the Supabase CLI is installed, pull them down so git holds the real thing rather than a
hand-copy that could drift:

```bash
supabase link --project-ref kogpuuidawbmttyswvsx
```

```bash
supabase db pull
```

## What is in the database

- **12 listings**, all `live`, migrated from `listings.js` — same slugs, so existing property URLs
  (`property.html?id=dacera-corner-lot`) carry over as `/property/dacera-corner-lot`.
- **8 towns** across South Cotabato, Cotabato and Sultan Kudarat.
- **31 features**, **48 listing↔feature links**, **36 photo rows** (3 per listing, first marked primary).
- Photo rows point at storage keys like `lots/l09.jpg` and `houses/h08.jpg`. **The image files are not
  uploaded yet** — that is the first job of Phase 1.

## Security posture

RLS is on for all 11 tables. Verified by querying as the `anon` role with a draft listing present:

| Table | What anonymous sees |
|---|---|
| listings | 12 live, **0 drafts** |
| listing_photos / listing_features / towns | public reference data only |
| profiles, favorites, property_requests, verification_events, listing_views | **0 rows** |

Two advisor warnings remain and are **intentional**:

- `top_listings()` is callable by `anon` — that is its purpose: it returns view *counts* for the
  public Top Properties panel without exposing who viewed what.
- `is_staff()` is callable by `authenticated` — every policy calls it, so EXECUTE cannot be revoked
  from that role. It only reveals whether the caller themselves is staff. It has been revoked from
  `anon`.

## Notes for whoever builds Phase 1

- Types are generated at `types/database.types.ts`. Regenerate after any schema change.
- Never put the service role key in the browser. Public pages use the publishable key + RLS.
- `price_history` and `listing_views` are written automatically/by the app — the "Price reduced" and
  "Top Properties" panels read from them instead of the hardcoded rows in the mockup.
- Sale-only is enforced by omission: there is no rent or lease column anywhere. Keep it that way.
