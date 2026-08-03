import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

/**
 * Where a listing's photos live, and how they get from one bucket to the other.
 *
 * Two buckets hold the same object path. `listing-photos` is public — anything in
 * it is readable by URL forever, with or without a row pointing at it.
 * `listing-photos-draft` is private and only a staff session can read it, which is
 * what keeps an unpublished property off the internet.
 *
 * This module stays free of `next/headers` on purpose: client components import it
 * for its types and its bucket names, and a server-only import here would break
 * their bundle. Every function that talks to Storage therefore takes the Supabase
 * client from its caller instead of building one.
 */

type ListingStatus = Database['public']['Enums']['listing_status']
type Client = SupabaseClient<Database>

export const PUBLIC_BUCKET = 'listing-photos'
export const DRAFT_BUCKET = 'listing-photos-draft'

export type PhotoBucket = typeof PUBLIC_BUCKET | typeof DRAFT_BUCKET

/** How long a draft-bucket preview link stays valid. Long enough for one editing session. */
export const SIGNED_URL_TTL_SECONDS = 3600

/** What Storage accepts, and what the upload control offers. */
export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const ALLOWED_PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const

/** The bucket's own ceiling. Checked again in the browser after downscaling. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024

/**
 * Which bucket holds this listing's photos right now.
 *
 * `withdrawn` maps to the public bucket because the lifecycle graph only reaches
 * `withdrawn` from `live` — a withdrawn listing has always been published, so its
 * objects are already public and moving them back would be churn over bytes the
 * internet has already seen (run assumption A4/A10). If the graph ever gains a
 * `list → withdrawn` edge this function has to grow a `published_at` branch.
 *
 * DRAFT_BUCKET keeps its name. It is a Supabase storage bucket identifier
 * (`listing-photos-draft`), not a status value, and renaming a bucket means moving
 * every object in it — the listing_status rename in apply 2 has nothing to do with it.
 */
export function bucketForStatus(status: ListingStatus): PhotoBucket {
  switch (status) {
    case 'list':
    case 'for_approval':
      return DRAFT_BUCKET
    case 'live':
    case 'sold':
    case 'withdrawn':
      return PUBLIC_BUCKET
  }
}

/** The other bucket — the one an object might have been left in by a half-finished move. */
export function otherBucket(bucket: PhotoBucket): PhotoBucket {
  return bucket === PUBLIC_BUCKET ? DRAFT_BUCKET : PUBLIC_BUCKET
}

/**
 * `listings/<listingId>/<uuid>.<ext>` — the listing id in the path is what lets the
 * server check that an upload claiming to belong to a listing actually landed under
 * that listing's prefix. Legacy objects (`houses/h08.jpg`) predate the scheme and
 * stay valid; only new uploads are held to it.
 */
export function photoObjectPath(listingId: string, extension: string): string {
  return `listings/${listingId}/${crypto.randomUUID()}.${extension}`
}

export function isValidPhotoPath(path: string, listingId: string): boolean {
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  if (!new RegExp(`^${uuid}$`, 'i').test(listingId)) return false
  const pattern = new RegExp(
    `^listings/${listingId}/${uuid}\\.(${ALLOWED_PHOTO_EXTENSIONS.join('|')})$`,
    'i'
  )
  return pattern.test(path)
}

/**
 * Browser-visible URLs for a set of stored objects, keyed by storage path.
 *
 * The bucket derived from status is only the *expected* home. A publish that moved
 * objects and then failed to flip the status, or a compensating pass that only got
 * halfway, leaves objects in the other bucket — so each path that comes up missing
 * is looked for on the other side before the panel gives up and shows a placeholder.
 * A null value means "no preview", never "no photo": the row still exists and must
 * still be manageable.
 */
export async function displayUrls(
  supabase: Client,
  paths: string[],
  bucket: PhotoBucket
): Promise<Record<string, string | null>> {
  const urls: Record<string, string | null> = {}
  if (!paths.length) return urls

  const missing: string[] = []

  if (bucket === PUBLIC_BUCKET) {
    // getPublicUrl only builds a string, so presence has to be asked for separately.
    const checks = await Promise.all(
      paths.map(async (path) => ({
        path,
        present: (await supabase.storage.from(PUBLIC_BUCKET).exists(path)).data === true,
      }))
    )
    for (const { path, present } of checks) {
      if (present) urls[path] = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl
      else missing.push(path)
    }
    Object.assign(urls, await signedUrls(supabase, missing, DRAFT_BUCKET))
  } else {
    Object.assign(urls, await signedUrls(supabase, paths, DRAFT_BUCKET))
    for (const path of paths) if (!urls[path]) missing.push(path)
    const checks = await Promise.all(
      missing.map(async (path) => ({
        path,
        present: (await supabase.storage.from(PUBLIC_BUCKET).exists(path)).data === true,
      }))
    )
    for (const { path, present } of checks) {
      urls[path] = present
        ? supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl
        : null
    }
  }

  for (const path of paths) if (!(path in urls)) urls[path] = null
  return urls
}

/** One batched signing round trip; a path Storage could not sign comes back null. */
async function signedUrls(
  supabase: Client,
  paths: string[],
  bucket: PhotoBucket
): Promise<Record<string, string | null>> {
  const urls: Record<string, string | null> = {}
  if (!paths.length) return urls

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)

  if (error || !data) {
    for (const path of paths) urls[path] = null
    return urls
  }

  for (const entry of data) {
    if (!entry.path) continue
    urls[entry.path] = entry.error ? null : entry.signedUrl
  }
  return urls
}

export type PhotoMoveOutcome = 'moved' | 'already_there' | 'failed'

export type PhotoMoveEntry = {
  path: string
  outcome: PhotoMoveOutcome
  /** Only set when the outcome is `failed`, for the message the clerk reads. */
  reason?: string
}

/**
 * Never a boolean: publishing has to be able to say *which* photo did not make it,
 * because the person reading the message is the one who has to fix it.
 */
export type MoveReport = {
  /** True only when every path was verified present in the destination afterwards. */
  ok: boolean
  entries: PhotoMoveEntry[]
  moved: string[]
  failed: string[]
}

/**
 * Moves every object into the public bucket and then proves they arrived.
 *
 * Retry-forward, deliberately: when one object fails the pass keeps going and the
 * report names the failure. Unwinding siblings mid-pass would add a second way to
 * fail while the caller is already handling the first, and the operation is
 * idempotent anyway — a retry finds the already-moved objects present and reports
 * `already_there` instead of erroring.
 *
 * The verification sweep at the end is the part publishing depends on: status only
 * flips after every photo is readable from the public bucket, so the public site can
 * never render a live listing with a broken image.
 */
export async function movePhotosToPublic(supabase: Client, paths: string[]): Promise<MoveReport> {
  return movePhotos(supabase, paths, DRAFT_BUCKET, PUBLIC_BUCKET)
}

/**
 * The compensating pass. A publish that moved the photos and then failed to flip
 * the status has left them public while the listing is still `for_approval`, which
 * makes the bucket-from-status rule a lie and exposes photos of an unpublished
 * property. Best effort and run exactly once: if it fails too, the caller reports
 * the paths so a human can finish the job rather than looping.
 */
export async function movePhotosToDraft(supabase: Client, paths: string[]): Promise<MoveReport> {
  return movePhotos(supabase, paths, PUBLIC_BUCKET, DRAFT_BUCKET)
}

async function movePhotos(
  supabase: Client,
  paths: string[],
  from: PhotoBucket,
  to: PhotoBucket
): Promise<MoveReport> {
  const entries: PhotoMoveEntry[] = []

  for (const path of paths) {
    const { error } = await supabase.storage.from(from).move(path, path, { destinationBucket: to })
    if (!error) {
      entries.push({ path, outcome: 'moved' })
      continue
    }

    // The usual cause of a failed move is that a previous attempt already made it.
    const { data: present } = await supabase.storage.from(to).exists(path)
    entries.push(
      present === true
        ? { path, outcome: 'already_there' }
        : { path, outcome: 'failed', reason: error.message }
    )
  }

  // Verify rather than trust: a move that reported success but left nothing behind
  // would otherwise publish a listing whose photos 404.
  const verified = await Promise.all(
    paths.map(async (path) => ({
      path,
      present: (await supabase.storage.from(to).exists(path)).data === true,
    }))
  )
  const absent = new Set(verified.filter((v) => !v.present).map((v) => v.path))

  const final = entries.map((entry) =>
    absent.has(entry.path) && entry.outcome !== 'failed'
      ? { ...entry, outcome: 'failed' as const, reason: 'not found in the destination bucket' }
      : entry
  )

  return {
    ok: final.every((entry) => entry.outcome !== 'failed'),
    entries: final,
    moved: final.filter((e) => e.outcome !== 'failed').map((e) => e.path),
    failed: final.filter((e) => e.outcome === 'failed').map((e) => e.path),
  }
}

/**
 * Deletes one object without needing to know which bucket it ended up in.
 *
 * Both buckets are checked because a half-finished publish can leave an object on
 * either side, and "the row is gone but the file is still served" is the one outcome
 * that must not pass silently — a deleted photo of a real property staying reachable
 * by URL is the failure this whole two-bucket scheme exists to prevent.
 */
export async function removePhotoObject(
  supabase: Client,
  path: string,
  expected: PhotoBucket
): Promise<{ ok: boolean; removedFrom: PhotoBucket[]; reason?: string }> {
  const order: PhotoBucket[] = [expected, otherBucket(expected)]
  const removedFrom: PhotoBucket[] = []
  let reason: string | undefined

  for (const bucket of order) {
    const { data: present } = await supabase.storage.from(bucket).exists(path)
    if (present !== true) continue
    const { error } = await supabase.storage.from(bucket).remove([path])
    if (error) reason = error.message
    else removedFrom.push(bucket)
  }

  // Still present anywhere after the pass means the object outlived its row.
  const stillThere = await Promise.all(
    order.map(async (bucket) => (await supabase.storage.from(bucket).exists(path)).data === true)
  )

  return { ok: !stillThere.some(Boolean), removedFrom, reason }
}
