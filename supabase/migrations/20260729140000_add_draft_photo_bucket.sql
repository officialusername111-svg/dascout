-- Phase 4 anchor 1: draft-listing photos must not sit in the public "listing-photos"
-- bucket, because that bucket serves any object by its predictable path regardless of
-- the listing's status (PHASE-4-BRIEF trap #2). This creates the private counterpart:
-- same size/type limits, staff-only read+write, objects move to the public bucket only
-- once the listing is verified and about to go live.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-photos-draft',
  'listing-photos-draft',
  false,
  10485760,  -- 10 MB, matching listing-photos
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Staff SELECT: required to render a signed preview URL for a draft photo in the admin
-- edit screen (the bucket is private -- no plain public URL exists), and because
-- supabase-js's move()/copy() with a destinationBucket option requires `select` on the
-- source object per its own documented RLS contract (see note at the end of this file).
drop policy if exists draft_bucket_staff_select on storage.objects;
create policy draft_bucket_staff_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'listing-photos-draft'
    and (select public.is_staff())
  );

-- Staff INSERT: new photo uploads while a listing is draft/verifying land here,
-- client -> Storage direct per anchor 5.
drop policy if exists draft_bucket_staff_insert on storage.objects;
create policy draft_bucket_staff_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'listing-photos-draft'
    and (select public.is_staff())
  );

-- Staff UPDATE: covers upsert-on-conflict re-uploads, and supplies the SOURCE-side
-- requirement for supabase-js move() -- see note below on why this, not delete, is
-- what a cross-bucket move actually needs.
drop policy if exists draft_bucket_staff_update on storage.objects;
create policy draft_bucket_staff_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'listing-photos-draft'
    and (select public.is_staff())
  )
  with check (
    bucket_id = 'listing-photos-draft'
    and (select public.is_staff())
  );

-- Staff DELETE: explicit photo delete, and the source-side cleanup step if publish is
-- implemented as copy() + remove() instead of move().
drop policy if exists draft_bucket_staff_delete on storage.objects;
create policy draft_bucket_staff_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'listing-photos-draft'
    and (select public.is_staff())
  );

-- Staff SELECT on the PUBLIC bucket: the publish flow verifies every object's arrival
-- with exists() and the upload flow checks the destination before recording a row --
-- both are storage API reads, which the public bucket's plain-URL serving does not
-- cover (RLS still applies to the API surface).
drop policy if exists public_bucket_staff_select on storage.objects;
create policy public_bucket_staff_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'listing-photos'
    and (select public.is_staff())
  );

-- Move-between-buckets, verified against the installed @supabase/storage-js source
-- (web/node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts, JSDoc
-- @remarks on move()/copy()):
--   .move(from, to, { destinationBucket })  needs objects permissions: update + select
--   .copy(from, to, { destinationBucket })  needs objects permissions: insert + select
-- move() is ONE UPDATE against the existing row (bucket_id/name change in place); the
-- policies above satisfy the source side, and the destination side's WITH CHECK --
-- evaluated against the row's NEW values (bucket_id = 'listing-photos') -- is satisfied
-- by the public bucket's existing staff UPDATE policy, unchanged by this migration.
-- The pre-build storage spike (run record D12) is the hard gate proving sufficiency.
