# Run record — run-p4-admin (Phase 4: admin & verification)

Write-ahead decision trail per the Autonomy Contract (§0). Appended as the run progresses;
committed with the run. Pre-run HEAD `6277ac4` on `main`; work on `auto/run-p4-admin`.
Intake: staff sign-in, listing create/edit, photo upload with reordering, lifecycle
draft → verifying → live → sold with verification events (BUILD-PLAN Phase 4, PHASE-4-BRIEF).
Tier Large. Terminal state: **done-green** (2026-07-30 ~02:55 +08).

**Verification summary:** 33 Vitest + 48 Playwright tests, all executed and green (harness
bootstrapped from zero this run). Criteria: 34/36 PASS with executed evidence; AC-4b satisfied
via the builder's executed HTTP denials + the executed RLS-layer denial proofs (a durable
wire-protocol replay test is parked as a follow-up); AC-26(iv) structurally unreachable for
post-Phase-4 data (cover invariant), legacy-only; AC-15b deferred (unconstructible: a 1920px
re-encode cannot exceed 10 MB; the bucket cap is the proven backstop). Two verify-fix cycles:
(1) create-form field retention — fixed, regression test flipped and green; (2) reorder torn-write
window measured under hosted latency — fixed via single-transaction `reorder_listing_photos` RPC
(migration D), confirmed by DB polling with zero torn observations. GREEN gate: build clean,
tests executed, test-integrity clean (intake snapshot was zero tests; nothing weakened),
no protected paths, no staged secrets.

**DB end-state:** hosted project at content baseline (12 listings, 28 legacy photo objects,
0 events) plus the Phase 4 infrastructure (draft bucket + 6 storage policies, publish-guard
trigger, append-only events policies, FK RESTRICT, reorder RPC). All 28 test listings, 74 test
events, and 41 test storage objects swept via the postgres/Storage-API channel after
verification. Test fixture users retained for the committed suite (`test-staff-p4@` /
`test-buyer-p4@dascout.local`, creds only in web/.env.local) — rotate or delete when Phase 4 is
reviewed; deleting them orphans nothing (events FK is SET NULL, and all test events are swept).

## Decisions (write-ahead — each precedes the work it authorizes)

- **D1** Auth built inside Phase 4 (staff sign-in only); Phase 3 reuses it. Basis: intake names
  staff sign-in; `@supabase/ssr` plumbing already live from Phase 2.
- **D2** Draft photos live in a new **private** bucket `listing-photos-draft`; same object path in
  both buckets; bucket derived from `status` + `published_at` (`live|sold` → public,
  `draft|verifying` → private, `withdrawn` → public iff `published_at`). Photos of a once-live
  listing stay public on withdraw (assumption A4/A10; hardening proposal parked).
- **D3** No service-role key anywhere. All admin reads/writes/storage ops run as the signed-in
  staff user under RLS.
- **D4** Publish preconditions: ≥1 `title_check` + ≥1 `ground_validation` event, ≥1 photo, exactly
  one primary. DB trigger backstops the event rule AND writes the `published` event **inside the
  trigger, atomic with the status flip** (DBA ruling, closes SA risk R2). App owns the full graph:
  draft→verifying, verifying→draft, verifying→live, live→sold, live→withdrawn, withdrawn→live;
  `sold` terminal. Relist accepts historical events; every →live transition (incl. relist) gets a
  `published` event.
- **D5** `verification_events` becomes append-only for staff (SELECT+INSERT, no UPDATE/DELETE),
  INSERT requires `performed_by = auth.uid()` (no actor spoofing). App-side `recordVerificationEvent`
  rejects kind `published` (trigger-only).
- **D6** Cover-photo invariant: `is_primary === (sort_order === 0)`, forward-only (36 legacy rows
  untouched; reads unaffected). Deleting the cover promotes the next photo. Reorder is an explicit
  whole-order rewrite (`reorderPhotos`), idempotent.
- **D7** Uploads: client downscales (canvas, longest edge ≤1920, re-encode WebP q0.9 — strips
  EXIF/GPS; JPEG 0.85 fallback), uploads direct to Storage under the staff JWT, then a server
  action records the row after validating the path shape `listings/<listingId>/<uuid>.<ext>` and
  the object's existence. Server actions never carry file bytes.
- **D8** Migrations applied to the hosted Supabase project by the orchestrator via MCP — the
  project's established dev workflow (Phases 0–2 + security hardening all did this); everything
  additive and non-breaking for public reads; app code stays local until the parked push.
- **D9** Test fixtures: `test-staff-p4@dascout.local` (role staff) and `test-buyer-p4@dascout.local`
  (role buyer) seeded in auth.users via SQL (guard-trigger dance recorded in PLAN.md; the guard was
  never weakened). Credentials in `web/.env.local` only. Both API-smoke-verified before build.
  Rotate/delete post-review.
- **D10** Admin screens reuse the approved design system verbatim (`globals.css` classes); no new
  visual direction — the standing UI-sample gate is satisfied by that constraint; screenshots go in
  the review packet.
- **D11** New dependencies this run, each named in BUILD-PLAN §2: `zod` (v4 idiom), `vitest`,
  `@playwright/test` (dev). Nothing else.
- **D12** Migration files are transcribed by the TL from the DBA-approved SQL below and applied
  A→B→C with per-migration verification; a storage spike (move + signed URLs + exists as the TEST
  staff user) must pass before the photo pipeline is built.

## Frozen interface contract (condensed; SA contract v1.0 + TL rulings — binding)

**Files.** Routes: `app/admin/layout.tsx` (noindex metadata ONLY — no guard, no robots key on any
child page), `app/admin/sign-in/page.tsx` (public), `app/admin/(staff)/layout.tsx` (requireStaff +
nav + sign-out), `app/admin/(staff)/page.tsx` (index), `app/admin/(staff)/listings/new/page.tsx`,
`app/admin/(staff)/listings/[id]/page.tsx`. Actions: `app/admin/actions.ts`. Lib:
`lib/admin/{auth,queries,photos,downscale,types}.ts`. Client components:
`components/admin/{SignInForm,ListingForm,FeaturesForm,PhotoManager,PhotoCard,VerificationPanel,LifecyclePanel}.tsx`.
`app/robots.ts` gains `disallow: '/admin'`. Sitemap content untouched.

**Guard.** `checkStaff()`/`getStaffUser()`/`requireStaff()` in `lib/admin/auth.ts`, React
`cache()`-memoised, `auth.getUser()` (never `getSession()` alone) + own-row `profiles.role` select.
Guard runs in the `(staff)` layout (UX), in **every** exported `lib/admin/queries.ts` function
(data boundary), and as the first two lines of **every** action (`const user = await getStaffUser();
if (!user) return DENIED`). Redirects: anonymous → `/admin/sign-in`, non-staff →
`/admin/sign-in?denied=1`. `signIn` signs a non-staff session straight back out. One uniform
denial message; never confirm an email exists. Client components under `components/admin/` may
import only from `app/admin/actions.ts`, `lib/admin/photos.ts` (types), `lib/admin/downscale.ts`,
`lib/supabase/client.ts` — never `lib/admin/auth.ts`/`queries.ts` (Turbopack hard-fails
`next/headers` in client bundles).

**Result shape.** `ActionResult<T> = { ok:true; message?; warning?; data? } | { ok:false; code:
'validation'|'forbidden'|'not_found'|'conflict'|'precondition'|'storage'|'unexpected'; message;
fieldErrors? }`. Forms use `useActionState` from `react` (`(prev, formData)` signature, initial
`null`, `pending` disables submit); list buttons use `useTransition` + typed-input actions
(family B), which still zod-parse. Field errors render via existing `.field.invalid .ferr`;
banners via `.fmsg.ok`/`.fmsg.err`; `warning` on an ok result renders in `.fmsg.err`.

**Actions.** `signIn`(A: email zod-validated lowercase, password min 1; wrong-anything → one
message; non-staff → signOut + DENIED; `redirect('/admin')` last, outside try) · `signOut`(C) ·
`createListing`(A: ListingFields zod — title 3..160, category 5-enum, price coerce positive
≤1e12, town_id uuid, optional positives/counts via blankToNull preprocess, is_trending checkbox
`=== 'on'`; slug from title, `23505` retry ×3 w/ random suffix; insert status `draft` +
`created_by`; redirect to edit) · `updateListing`(A: + id, slug editable only draft|verifying
else `precondition` field error; price writes never touch price_history — trigger does) ·
`saveListingFeatures`(A: `getAll('featureIds')`, `[]` means clear-all; delete-then-insert) ·
`addListingPhoto`(B: validate path regex against listingId, `exists()` in the status-derived
bucket before insert, sort_order = max+1, is_primary = first-photo) · `updatePhotoMeta`(A: alt
≤200, ''→null) · `reorderPhotos`(B: submitted id-set must equal current set else `conflict`;
rewrite sort_order = index; primary follows index 0) · `setPrimaryPhoto`(B: clear-all-primaries →
set target → resequence; self-healing on partial) · `deletePhoto`(B: refuse last photo of a live
listing (`precondition`); row first then object; object-delete failure → ok + warning; cover
delete promotes next) · `recordVerificationEvent`(A: kind ∈ {title_check, ground_validation} —
`published` rejected at schema; ground_validation requires notes ≥10 chars; performed_by from
session only) · `transitionListing`(A: TRANSITIONS map as D4; `expectedFrom` hidden-input CAS;
sequence: guard → zod → load ctx → optimistic status check → graph check → publish preconditions
(named blockers, same predicate as `publishBlockers`) → `movePhotosToPublic` → guarded UPDATE
`.eq('status', expectedFrom)` 0-rows → `conflict`; trigger raise → `precondition`; **no app-side
published insert — trigger owns it**) · revalidation per map: admin paths always; `/` +
`/property/<slug>` when public-visible (and always on transitions); `/sitemap.xml` on transitions
and public-listing updates (the sitemap call is load-bearing — sitemap.ts is cached; verify under
`next build && next start`, not dev).

**Queries.** `lib/admin/queries.ts`: `getAdminListings(filters)` (status filter, ilike q escaped
like the public read, sort whitelist, page size 25, PGRST103 fallback, empty shape `{rows:[],
total:0,page:1,pageCount:0}`) · `getAdminListingDetail(id)` (photos sort_order asc + created_at
tiebreak; events occurred_at desc; `uploadBucket`, `slugEditable`, `allowedTransitions`,
`publishBlockers` computed server-side) · `getTownOptions()` · `getFeatureOptions()`. Every
function opens with `await requireStaff()`.

**Photos lib.** `bucketForStatus(status, publishedAt)` per D2 · `photoObjectPath` ·
`isValidPhotoPath` · `displayUrls()` — public bucket via existing `photoUrl()` from
`lib/queries.ts`, draft bucket via one batched `createSignedUrls(paths, 3600)` server-side only;
missing → `.empty` placeholder · `movePhotosToPublic()` — per-object `move(path, path,
{destinationBucket})`, on error `exists()` in public → `already_public`, verify-all in public
before ok, best-effort rollback on failure, returns per-object `MoveReport` never a boolean.

**Timestamps** rendered via `Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', … })`; no
date is ever parsed from a form; `published_at`/`sold_at`/`occurred_at` are DB-stamped.

## Migrations (final SQL — DBA spec + TL amendment; files under `supabase/migrations/`)

### A — `20260729140000_add_draft_photo_bucket.sql`

As DBA spec'd: idempotent `insert … on conflict do update` of bucket `listing-photos-draft`
(private, 10 MB, jpeg/png/webp) + 4 policies `draft_bucket_staff_{select,insert,update,delete}`
on `storage.objects` (`bucket_id = 'listing-photos-draft' and (select public.is_staff())`),
**plus TL amendment (named need: contract's `exists()` verification and upload-existence checks
run against the public bucket; DBA finding F1's on-demand condition met):**

```sql
-- Staff SELECT on the PUBLIC bucket: the publish flow verifies every object's arrival
-- with exists() and the upload flow checks the destination before recording a row --
-- both are storage reads, which the public bucket's plain-URL behavior does not cover.
drop policy if exists public_bucket_staff_select on storage.objects;
create policy public_bucket_staff_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'listing-photos'
    and (select public.is_staff())
  );
```

Move mechanics (grounded in installed storage-js source): `move()` = one UPDATE (bucket_id in
place); source side covered by draft select+update policies, destination side by the public
bucket's existing staff UPDATE with_check. Verified queries + rollback notes: DBA report (bucket
row, 5 policy rows; rollback safe only while draft bucket is empty — past that, drop write
policies only).

### B — `20260729140100_add_publish_guard_trigger.sql`

DBA SQL verbatim: `guard_listing_publish()` — plpgsql, SECURITY DEFINER, `set search_path = ''`;
on `before update of status`, when `new.status='live' and old.status is distinct from 'live'`:
require ≥1 `title_check` and ≥1 `ground_validation` for the listing else raise
(`errcode check_violation`); then insert the `published` event `(new.id, 'published', auth.uid())`
— atomic with the flip; `auth.uid()` still attributes the real staff actor under definer context.
Backstop-only scope (app owns the full graph). Existing 12 live rows untouched (triggers never
fire retroactively). Verification: trigger present; negative test (→live without events raises)
and positive test (with events, flip succeeds + 1 published row) both inside `begin…rollback`.

### C — `20260729140200_tighten_verification_events_policies.sql`

DBA SQL verbatim: drop `verification_events_staff_all`; create `verification_events_staff_select`
(SELECT, `is_staff()`) and `verification_events_staff_insert` (INSERT, `is_staff() and
performed_by = (select auth.uid())`). No UPDATE/DELETE policy → denied. Trigger's own insert
bypasses RLS (definer) yet records the true actor. 0 rows today; nothing breaks. Rollback SQL
recorded but flagged integrity-weakening — deliberate decision only.

**Apply order A→B→C** (additive first; the only grant-narrowing change last).
**Superuser caveat:** RLS-denial negatives can't be proven from the MCP channel (postgres bypasses
RLS) — BT proves them from real authenticated sessions.

## Acceptance criteria

BA's AC-1..AC-35 (verbatim text held in the BA report within the run transcript; AC-1..8 re-emitted
on continuation) + TL's AC-36 (admin noindex/robots/sitemap) + TL amendment to AC-17(b) (cover
delete promotes next photo — supersedes no-auto-promotion, consequence of D6). Groups: A sign-in/
authz · B create/edit validation · C photos · D events · E lifecycle · F public-visibility truths ·
G failure paths.

## Panel outcome (advisory review, 4 blind reviewers, merged 23:20)

Verdicts: correctness PROCEED-WITH-BINDINGS (CL-1..7) · security/data PROCEED-WITH-BINDINGS
(SL-1..10) · simplicity/scope PROCEED-WITH-BINDINGS (SP-1..6) · security-skeptic ledger SS-1..16
(2 BREAKS, both closed below). No HALT; no parked slice. Facts verified live during merge:
`verification_events.listing_id` FK was ON DELETE CASCADE (SS-2 confirmed critical);
`performed_by` FK is SET NULL (fixture deletion safe); `profiles_guard_role` tgenabled='O'
(SS-6 check passed after fixture seeding).

**Recorded split + TL resolution:** SP-1 (drop the best-effort rollback in `movePhotosToPublic`;
retry-forward only — rollback is a second failure surface) vs SL-2/CL-2 (photos moved but flip
failed strands objects public and makes bucket derivation lie; wants compensation). Resolution:
the move itself is retry-forward (no mid-move rollback when sibling objects fail); a **post-move
flip failure** (CAS 0-rows / trigger raise) triggers ONE best-effort compensating pass
public→draft with the same per-object idempotent machinery; and the three object-touching ops
gain **either-bucket resilience** regardless (deletePhoto checks both buckets before declaring an
object gone; addListingPhoto's exists() falls back to the other bucket; displayUrls falls back
per path). This satisfies both lenses' actual concerns.

**Migration amendments (final — supersede the sections above):**

- **Migration B** is broadened per SS-1/CL-1: trigger becomes `before insert or update of status`;
  INSERT with `status in ('live','sold')` raises (a row born public structurally cannot have
  events — they FK the row); UPDATE to `sold` raises unless `old.status = 'live'` (deliberately
  grandfathers the 12 legacy live rows — do NOT require events on →sold); UPDATE to `live` keeps
  the two-event requirement + the atomic `published` insert. Plus SL-7: `revoke execute` on the
  function from public/anon/authenticated (repo precedent).
- **Migration C** insert `with_check` becomes: `is_staff() AND performed_by = auth.uid() AND kind
  in ('title_check','ground_validation') AND occurred_at = now()` — closes `published` forgery
  (SL-1/CL-6/SS-3a) and backdating (SS-3b; the column default passes because both sides are the
  transaction timestamp). Plus SS-2: `verification_events_listing_id_fkey` re-created
  `ON DELETE RESTRICT` — a listing with recorded events becomes undeletable; an event-less draft
  stays deletable cleanup.
- **Migration A** unchanged (DBA SQL already carries `to authenticated` on all four draft-bucket
  policies — SL-4 is a transcription-fidelity requirement, honored).

**Contract addenda binding BD (numbered, from the merge):**
1. `movePhotosToPublic` retry-forward; flip-failure compensating pass; per-object reports.
2. Either-bucket resilience in `deletePhoto` / `addListingPhoto` exists / `displayUrls`;
   `deletePhoto`'s object-failure warning must say the file may still be publicly reachable and
   name the path (SL-8).
3. `reorderPhotos` write order: clear all primaries → write new sort_orders → set primary at
   index 0 (CL-3; avoids 23505 on every cover change).
4. `addListingPhoto`: empty photo set ⇒ sort_order 0; primary-race 23505 mapped to `conflict`
   (CL-7i).
5. `createListing`: unsluggable title ⇒ fallback slug base `listing` + random suffix (CL-7ii).
6. Uploads blocked while `withdrawn` (`precondition` + control hidden; relist first) (SL-5).
7. Town add is CUT — towns are select-only this run (SP binding 2).
8. No new dependency for reorder/upload UI — native controls, existing classes (SP binding 3).
9. `lib/admin/types.ts` folded into owning modules unless a real import cycle appears (SP-2).
10. `bucketForStatus`: `withdrawn → public` with a comment naming the frozen-graph assumption —
    no dead `published_at` branch (SP-4).
11. `X-Robots-Tag: noindex` header for `/admin/:path*` in next.config.ts, in addition to the
    metadata + robots.ts mechanics (SL-10).
12. The storage spike is a HARD GATE on Migration A sufficiency before the photo pipeline is
    built (CL-5).
13. BT scope: exactly the AC matrix — RLS-denial proofs at the Vitest/supabase-js layer, browser
    e2e only for the journeys; no coverage tooling/CI/visual-regression this run (SP-5).

**Packet notes carried from the panel (not build items):** CSP `unsafe-inline` park re-titled
"blocking before Phase 5" (SL-6/SS-4); residual sign-in control is Supabase's default auth rate
limits (SL-9/SS-5, dashboard check = owner action); fixtures are 128-bit random passwords, packet
carries a dated delete/rotate action (SL-3); postgres/MCP channel named as the residual trust
root over the audit trail (SS-7); Next server-action CSRF reliance named (SS-11); un-publish-an-
image operational path documented (SS-13: withdraw → delete photo); trail proves who-claimed-
what-when, not that fieldwork happened (SS-3 residue); SS-14 legacy-object overwrite parked with
F2; owner promotion SQL must be one transaction ending with the tgenabled verification line
(SS-6).

## DBA findings carried (not built this run)

- F2: no DB CHECK on `storage_path` shape — parked (staff-only writes, path is client-generated).
- Public-bucket photo sort tiebreak on the public site — parked (no public-page changes this run).
- CSP `script-src 'unsafe-inline'` revisit now that admin exists (config's own comment) — parked,
  re-titled per panel: **blocking before Phase 5**.
- Sign-in throttling/lockout (BA proposal) — parked (residual control: Supabase default limits).
- Move draft-bucket objects back on withdraw (BA/AC-31 strict reading) — parked.

## Build outcome (BD, accepted 00:30)

Implementation complete; lint + build clean; routes and actions driven over HTTP against the
hosted DB with per-flow evidence in the BD report. **Seven CONTRACT-DEVIATIONs accepted by TL**,
all module-boundary/CSS realities, none touching security posture: (1) `bucketForStatus(status)`
single-arg per addendum 10; (2) `displayUrls` uses `storage.getPublicUrl()` (same URL shape) since
`lib/queries.ts` would drag `next/headers` into the client bundle; (3) `TRANSITIONS` +
`publishBlockersFor` live in `lib/admin/queries.ts` ('use server' modules may export only async
fns; no types.ts needed — no cycle appeared); (4) timestamps formatted server-side, passed as
label strings (hydration safety); (5) LifecyclePanel always renders its form so `expectedFrom`
is in served HTML; (6) new `.apanel` CSS primitive — `.card` is the square listing tile, wrong
shape for panels; tokens-only additions; (7) `server-only` package not added (not installed; the
transitive `next/headers` failure is the same wall). **BD proposals parked:** last-photo refusal
extended to sold; join-saving on updatePhotoMeta; single-statement reorder; status-index check
(DBA already ruled no index at this cardinality). **Cleanup owed (TL, post-BT):** test listing
`ad85fe8b-38eb-477b-9304-7ddcf13b2fda` + its 2 events — undeletable by staff by design; swept via
the postgres channel with any BT residue at run end.

## Acceptance criteria — verbatim (BA report; AC-17b amended by TL ruling D6; AC-36 added by TL)

**AC-1 (sign-in success).** Given the seeded staff account `TEST_STAFF_EMAIL` (`profiles.role='staff'`), when it submits the correct email/password at `/admin/sign-in`, then a session cookie is set via `@supabase/ssr` and the browser lands on `/admin` with the listing index rendered.

**AC-2 (wrong password).** Given the same account, when the form is submitted with the correct email and an incorrect password, then the submission is rejected, no session cookie is set, a field-level error renders on `/admin/sign-in` (not a 500/crash), and the user stays on that page.

**AC-3 (signed-out hits /admin).** Given no active session, when `/admin` (or any `/admin/*` route besides `/admin/sign-in`) is requested, then the response redirects to `/admin/sign-in` without any admin markup or data reaching the response first.

**AC-4 (buyer-role denied — the critical authz case).** Given a signed-in user with `profiles.role='buyer'` (the seeded `TEST_BUYER_EMAIL` account): (a) when that browser's session requests `GET /admin`, then no admin markup/data reaches the response and the user is redirected away; (b) when that same session invokes an admin server action directly (bypassing the `/admin` UI entirely), then the action's own independent `requireStaff()` check rejects it before any DB write. Both (a) and (b) must hold; either alone is insufficient.

**AC-5 (session persistence, per-component).** Given a signed-in staff user, when they navigate `/admin` → `/admin/listings/[id]` without re-authenticating, then the session persists and the second page's server component independently re-resolves identity via `auth.getUser()` — never a cached `getSession()` — before rendering staff-only content.

**AC-6 (sign-out).** Given a signed-in staff user on any `/admin/*` page, when they trigger sign-out, then the session cookie is cleared and a subsequent `/admin` request redirects to `/admin/sign-in`.

**AC-7 (happy-path create).** Given `TEST_STAFF_EMAIL` on `/admin/listings/new`, when they submit title "Corner Residential Lot", category `residential_lot`, `price_php=1500000`, and a town selected from the seeded `towns` rows, then a `listings` row is inserted with `status` defaulting to `draft`, `created_by` set to the staff user's id, a slug generated from the title, and `price_php` stored as entered with no currency conversion; the form exposes no rent/lease toggle and no price-period unit anywhere — sale-only, pesos.

**AC-8 (required fields).** Given the create form, when any one of title / category / price_php / town is left blank (tested independently, the other three valid), then the action returns a field-keyed error for that field and no row is inserted.

**AC-9 (price boundary, form-first).** Given the create form otherwise valid, when `price_php` is submitted as `0` or a negative number, then the zod schema rejects it server-side with a field-keyed error, and the request never reaches Postgres's `CHECK (price_php > 0)` — the user sees a clean field-specific message, never a raw constraint-violation.

**AC-10 (category + town reference integrity).** (a) Given a request sets `category` outside the 5 enum values (e.g. a tampered POST with `category=rental_unit`), when submitted, then it is rejected with no row written; the form's category control offers only the 5 values. (b) Given a request's `town_id` does not exist in `towns`, when submitted, then it is rejected with a field-keyed error; the town control is a select populated only from `towns`.

**AC-11 (optional numerics).** (a) Given `lot_area_sqm` (or `floor_area_sqm`) is submitted as `0` or negative, then a field-keyed error rejects it; given the field is left blank instead, the row is accepted with that column `null`. (b) Given `bedrooms` (or `bathrooms`) is submitted as `-1`, then a field-keyed error rejects it; given `bedrooms=0`, the row is accepted with `bedrooms=0`.

**AC-12 (slug).** (a) Given no existing listing has the slug the title would generate, when a staff user creates that listing, then a URL-safe slug is generated and stored. (b) Given an existing listing already holds that slug, when a second listing is created with the same title, then the new slug is uniquified with a suffix rather than colliding or erroring. (c) Given a listing whose status is `live`, `sold`, or `withdrawn`, when a staff user attempts to change its slug, then the change is rejected or not offered — slug is editable only while `draft`/`verifying`.

**AC-13 (editing — features + status-agnostic field edits).** (a) Given a staff user editing an existing listing, when they check 3 feature chips and save, then 3 rows are written to `listing_features`; unchecking one previously-saved feature and saving again removes exactly that one link row. (b) Given a `live` listing, when staff edit `price_php` and save, then the update succeeds — field edits are allowed in every status, only status changes are gated — and the existing price trigger writes a `price_history` row.

**AC-14 (valid upload + alt text).** Given a staff user on a `draft`/`verifying` listing's edit page and a source JPEG 15 MB / 4000×3000px, when they select it for upload, then the client downscales to ≤1920px longest edge before any network request, the re-encoded file is well under 10 MB, the object lands in `listing-photos-draft` at `listings/<listing_id>/<uuid>.<ext>`, and a `listing_photos` row is created — the 10 MB cap is checked post-downscale. Alt text saves to `alt_text`; blank stays `null` (never a publish precondition).

**AC-15 (invalid uploads).** (a) A file with an unsupported MIME type (e.g. `.gif`, `.pdf`) is rejected client-side, before any Storage request, naming the accepted types. (b) A file whose re-encoded size still exceeds 10 MB after downscale is rejected before the Storage write.

**AC-16 (reorder persists).** Given a listing with 3 photos A/B/C at `sort_order` 0/1/2, when a staff user moves C to first position and the reorder action completes, then `sort_order` is persisted for all three rows (C=0, A=1, B=2) — not just client state — and reloading the edit page (fresh server request) shows the new order.

**AC-17 (primary invariant).** (a) Given photo A `is_primary=true`, B `is_primary=false`, when staff set B as primary, then A's flag clears in the same operation that sets B's (never both true), so the partial unique index never raises to the user. (b) **[TL-amended per D6]** Given the cover (primary) photo is deleted and other photos remain, then the next photo (new position 0) becomes the cover in the same operation — the invariant `is_primary === (sort_order === 0)` holds after every write from this run; a legacy listing with zero primaries still renders and publish still blocks per AC-26(iv) until one is designated.

**AC-18 (delete removes row + object).** Given a photo exists as both a `listing_photos` row and a Storage object, when a staff user deletes it, then both the row and the object are removed — an orphaned row or orphaned object fails this criterion.

**AC-19 (publish moves photos).** Given a `verifying` listing with N photos in `listing-photos-draft`, when it publishes successfully, then all N objects move to the public `listing-photos` bucket at identical paths, the move is verified complete before status flips to `live`, and a retry after partial failure checks the destination first and does not re-error on already-moved objects.

**AC-20 (record title_check).** Given `TEST_STAFF_EMAIL` on a listing's edit page, when they submit "record title check" with notes (or blank), then a `verification_events` row is inserted with `kind='title_check'`, `performed_by` set from the session (a tampered client-supplied actor field is ignored server-side), `notes` as entered or `null`, `occurred_at` defaulting to now.

**AC-21 (record ground_validation).** Given the same context, when staff submit "record ground validation" with notes, then a row with `kind='ground_validation'` is inserted — tested separately from AC-20 because both kinds are independently required by AC-26: recording one never satisfies the other.

**AC-22 (append-only).** (a) Given a `verification_events` row exists, when any staff user — via UI or a direct staff-authenticated Supabase call — attempts to UPDATE it, then it is rejected: no edit path exists in the admin UI, and the tightened RLS policy rejects the UPDATE even for a direct call. (b) Given the same row, when a DELETE is attempted (UI or direct), then it is rejected the same way.

**AC-23 (events display).** Given a listing with 2 `title_check` events (different days) and 1 `ground_validation` event, when a staff user opens its edit page, then all 3 are visible in a verification panel, newest-first, each showing kind, timestamp, actor, notes.

**AC-24 (ungated transitions).** (a) Given a `draft` listing, when staff submit it for verification, then status becomes `verifying` — no precondition gates this move. (b) Given a `verifying` listing, when staff kick it back, then status returns to `draft` — also ungated.

**AC-25 (publish happy path).** Given a `verifying` listing with ≥1 `title_check`, ≥1 `ground_validation`, ≥1 photo, and exactly one primary, when staff publish it, then status becomes `live`; a `verification_events` row `kind='published'` with `performed_by`=the publishing staff user is auto-recorded; `published_at` is stamped by the existing trigger; and the home page and `/property/[slug]` reflect the newly-live listing without a redeploy.

**AC-26 (publish precondition failure, named).** Given a `verifying` listing missing exactly one of the four preconditions — tested independently for (i) zero `title_check`, (ii) zero `ground_validation`, (iii) zero photos, (iv) zero primary photos — with the other three satisfied each time, when staff attempt to publish, then the action is rejected before any status change and the error names the specific missing precondition, not a generic failure.

**AC-27 (DB backstop).** Given a `verifying` listing failing at least one publish precondition, when a request bypasses the app entirely and sets `status='live'` directly against Postgres under a staff-authenticated connection, then the publish-guard trigger raises and the transaction is rejected — status remains `verifying` — proving the guarantee holds even for a staff user with direct DB access. **[Panel-extended: also prove the INSERT-as-live and draft→sold bypasses raise (SS-1/CL-1).]**

**AC-28 (further transitions).** (a) Given a `live` listing, when staff mark it sold, then status becomes `sold` and `sold_at` is stamped. (b) Given a different `live` listing, when staff withdraw it, then status becomes `withdrawn`. (c) Given a `withdrawn` listing (events from its original publish still present), when staff relist it, then status becomes `live` again — relist does not require fresh events.

**AC-29 (disallowed transitions, named pairs).** (a) `draft` → publish directly to `live` (skipping `verifying`): rejected. (b) `sold` → any transition (tested: back to `live`, to `withdrawn`): rejected — `sold` is terminal. (c) `live` → directly to `draft` or `verifying`: rejected. (d) `draft` → directly to `sold` or `withdrawn`: rejected.

**AC-30 (DB rows, all three non-public statuses).** Given three listings with status `draft`, `verifying`, `withdrawn` respectively, each with ≥1 `listing_photos` and ≥1 `listing_features` row, when an anonymous client queries `listings`, `listing_photos`, or `listing_features` directly for any of the three, then RLS returns zero rows in every case.

**AC-31 (storage objects).** Given a `draft`/`verifying` listing's photo sits in `listing-photos-draft`, when an anonymous request hits its Storage URL directly, then it is denied — no bytes returned. Given instead a listing that was `live` (photos already moved to the public bucket) and is then `withdrawn`, when the same direct-URL request is made, then the object is still returned — the documented A4/A10 exception, not a defect.

**AC-32 (public site unchanged for live/sold).** Given the 12 existing listings remain in their current statuses, when an anonymous visitor loads the home page after Phase 4 ships, then search, filters, A–Z index, pagination, and `live` detail pages all render exactly as in Phase 2, and `sold` listings still appear in their "Just sold" rows without gaining or losing a detail-page link.

**AC-33 (duplicate submit).** Given a staff user has filled the create form completely and validly, when they double-click submit, then exactly one `listings` row is created (pending-state disabled submit + redirect).

**AC-34 (concurrent edit — last-write-wins, explicit v1 rule).** Given two staff sessions both load the same listing, when session 1 saves a price change and then session 2 — without reloading — saves a different price, then the final stored value is session 2's: silent overwrite, no conflict error. Both saves still fire the price trigger, so both changes appear in `price_history`.

**AC-35 (empty states).** (a) Given a newly-created `draft` listing with zero photos, its edit page's photo panel renders a graceful empty state — not a blank area, client error, or broken layout. (b) Given the same listing with zero events, the verification panel similarly renders a graceful empty state.

**AC-36 (TL — admin is unindexable).** Admin routes emit noindex robots metadata AND an `X-Robots-Tag: noindex` header; `robots.ts` disallows `/admin`; the sitemap contains no admin URL.
