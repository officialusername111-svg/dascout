'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import * as z from 'zod'
import { createClient } from '@/lib/supabase/server'
import { sendMatchAlerts } from '@/lib/match-alerts'
import { sendEmail } from '@/lib/email'
import { getStaffUser, getSuperAdmin, isStaffRole } from '@/lib/admin/auth'
import {
  CHECK_VIOLATION,
  FK_VIOLATION,
  RAISE_EXCEPTION,
  RLS_DENIED,
  UNIQUE_VIOLATION,
  blankToNull,
  blankToUndefined,
  denied,
  invalid,
  submittedValues,
  type ActionResult,
} from '@/lib/admin/action-result'
import {
  STATUS_LABELS,
  TRANSITIONS,
  publishBlockersFor,
  stampLabel,
} from '@/lib/admin/queries'
import {
  APPROVAL_SUBJECT,
  DemoteAdminSchema,
  INVITE_DUPLICATE,
  INVITE_REFUSED,
  INVITE_SUBJECT,
  InviteAdminSchema,
  InviteDecisionSchema,
  approvalEmailBody,
  classifyDecisionError,
  classifyInviteError,
  classifyRevokeError,
  describeApproveOutcome,
  describeDeclineOutcome,
  describeInviteSend,
  describeRevokeOutcome,
  inviteEmailBody,
  inviteLandingLink,
} from '@/lib/admin/invites'
import {
  PROPERTY_NO_TAKEN,
  PropertyNoField,
  isPropertyNoConflict,
} from '@/lib/admin/property-no'
import {
  bucketForStatus,
  isValidPhotoPath,
  movePhotosToDraft,
  movePhotosToPublic,
  otherBucket,
  removePhotoObject,
} from '@/lib/admin/photos'
import type { Database } from '@/lib/database.types'

/**
 * Every write the admin can make.
 *
 * Two rules hold for all of them, and both exist because a server action is a public
 * POST endpoint whichever page happens to render its form:
 *
 * 1. The first two lines re-check that the caller is staff. Rendering the form behind
 *    a guarded layout proves nothing about who sent the request.
 * 2. Nothing the browser sends is trusted for identity or state. The actor comes from
 *    the session, the listing's current status is re-read from the database, and the
 *    change is applied against that — never against what the form claimed.
 *
 * Failures come back as a value the form renders, not as an exception, whenever the
 * cause is something the person can fix. Genuine faults (a database that is not
 * answering) are left to throw so the error page and the logs both see them.
 */

type ListingStatus = Database['public']['Enums']['listing_status']

/**
 * The result shape, the SQLSTATE constants and the four builders now live in
 * `lib/admin/action-result.ts`, unchanged, because `'use server'` will not export a
 * non-async function and `app/admin/settings-actions.ts` needs the same helpers. The two
 * types are re-exported here so every existing
 * `import type { ActionResult } from '@/app/admin/actions'` keeps working.
 */
export type { ActionErrorCode, ActionResult } from '@/lib/admin/action-result'

/** Also deliberately uniform: it must not reveal whether the email is registered. */
const SIGNIN_FAILED = 'That email and password did not match an account.'

/**
 * The fields the listing form owns. Nothing here can set `status`, `published_at`,
 * `sold_at` or `created_by` — those belong to the lifecycle and to the session, and a
 * form that could post them would be a way around the whole verification flow.
 */
const listingFieldShape = {
  /**
   * First, because it is the identifier the office quotes to a seller or a buyer. It is
   * optional and stays optional: nothing refuses a listing that has none (see §2 of
   * `20260802131500_property_number_and_role_audit.sql`). Trimming, upper-casing and the
   * blank → null rule all live in `lib/admin/property-no.ts`.
   */
  property_no: PropertyNoField,
  title: z
    .string({ error: 'Give the listing a title.' })
    .trim()
    .min(3, { error: 'The title needs at least 3 characters.' })
    .max(160, { error: 'Keep the title under 160 characters.' }),
  category: z.enum(
    [
      'residential_lot',
      'farm_land',
      'commercial_lot',
      'residential_building',
      'commercial_building',
    ],
    { error: 'Choose one of the five property types.' }
  ),
  price_php: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: 'Enter the asking price in pesos, numbers only.' })
      .positive({ error: 'The asking price has to be more than ₱0.' })
      .max(1e12, { error: 'That price looks like a typo — check the number of zeroes.' })
  ),
  town_id: z.uuid({ error: 'Choose a town from the list.' }),
  area_detail: z.preprocess(
    blankToNull,
    z.string().trim().max(160, { error: 'Keep the barangay or area under 160 characters.' }).nullable()
  ),
  lot_area_sqm: z.preprocess(
    blankToNull,
    z.coerce
      .number({ error: 'Lot area must be a number of square metres, or left blank.' })
      .positive({ error: 'Lot area has to be more than 0 — leave it blank if unknown.' })
      .max(100_000_000, { error: 'That lot area looks like a typo.' })
      .nullable()
  ),
  floor_area_sqm: z.preprocess(
    blankToNull,
    z.coerce
      .number({ error: 'Floor area must be a number of square metres, or left blank.' })
      .positive({ error: 'Floor area has to be more than 0 — leave it blank if unknown.' })
      .max(100_000_000, { error: 'That floor area looks like a typo.' })
      .nullable()
  ),
  bedrooms: z.preprocess(
    blankToNull,
    z.coerce
      .number({ error: 'Bedrooms must be a whole number, or left blank.' })
      .int({ error: 'Bedrooms must be a whole number.' })
      .min(0, { error: 'Bedrooms cannot be negative.' })
      .max(999, { error: 'That bedroom count looks like a typo.' })
      .nullable()
  ),
  bathrooms: z.preprocess(
    blankToNull,
    z.coerce
      .number({ error: 'Bathrooms must be a whole number, or left blank.' })
      .int({ error: 'Bathrooms must be a whole number.' })
      .min(0, { error: 'Bathrooms cannot be negative.' })
      .max(999, { error: 'That bathroom count looks like a typo.' })
      .nullable()
  ),
  description: z.preprocess(
    blankToNull,
    z.string().trim().max(4000, { error: 'Keep the description under 4000 characters.' }).nullable()
  ),
  is_trending: z.preprocess((value) => value === 'on', z.boolean()),
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const CreateListingSchema = z.object(listingFieldShape)

const UpdateListingSchema = z.object({
  ...listingFieldShape,
  listingId: z.uuid({ error: 'That listing could not be identified.' }),
  slug: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .toLowerCase()
      .min(3, { error: 'The web address needs at least 3 characters.' })
      .max(90, { error: 'Keep the web address under 90 characters.' })
      .regex(SLUG_PATTERN, {
        error: 'The web address may only use lowercase letters, numbers and single hyphens.',
      })
      .nullable()
  ),
})

const StatusEnum = z.enum(['list', 'for_approval', 'live', 'sold', 'withdrawn'])

function listingFieldsFrom(formData: FormData) {
  return {
    property_no: formData.get('property_no'),
    title: formData.get('title'),
    category: formData.get('category'),
    price_php: formData.get('price_php'),
    town_id: formData.get('town_id'),
    area_detail: formData.get('area_detail'),
    lot_area_sqm: formData.get('lot_area_sqm'),
    floor_area_sqm: formData.get('floor_area_sqm'),
    bedrooms: formData.get('bedrooms'),
    bathrooms: formData.get('bathrooms'),
    description: formData.get('description'),
    is_trending: formData.get('is_trending'),
  }
}

/** Admin screens are never cached for long, but they must not lag a write either. */
function revalidateAdmin(listingId?: string): void {
  revalidatePath('/admin')
  if (listingId) revalidatePath(`/admin/listings/${listingId}`)
}

/**
 * The public side. The sitemap call is the one that is easy to forget and expensive to
 * miss: `sitemap.ts` is a cached route, so without this a newly published listing stays
 * absent from the sitemap until the next deploy.
 */
function revalidatePublic(slug: string): void {
  revalidatePath('/')
  revalidatePath(`/property/${slug}`)
  revalidatePath('/sitemap.xml')
}

function isPublicStatus(status: ListingStatus): boolean {
  return status === 'live' || status === 'sold'
}

/** "corner-residential-lot-general-santos" from whatever the clerk typed. */
function slugify(title: string): string {
  const base = title
    .normalize('NFKD')
    // Strip the combining accents NFKD just split off, so "Peñaranda" becomes
    // "penaranda" rather than "pe-aranda".
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
  // A title written entirely in non-Latin characters slugifies to nothing. Rather than
  // insert an empty unique column, fall back to a generic base and let the suffix do
  // the work — staff can rename it while the listing is still a draft.
  return base || 'listing'
}

function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 7)
}

// ---------------------------------------------------------------------------
// Sign in / sign out
// ---------------------------------------------------------------------------

const SignInSchema = z.object({
  email: z
    .string({ error: 'Enter the email address on your staff account.' })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'That does not look like an email address.' })),
  password: z.string({ error: 'Enter your password.' }).min(1, { error: 'Enter your password.' }),
})

/**
 * Signs a staff user in, and signs anyone else straight back out.
 *
 * The role check happens here rather than being left to the guard on the next request
 * so a buyer's session never exists in a state where it has been through the admin
 * sign-in form. The refusal reuses the same denial sentence as every other refusal.
 *
 * `redirect` throws by design, so it is the last statement and sits outside any
 * try/catch — a caught NEXT_REDIRECT would turn a successful sign-in into an error.
 */
export async function signIn(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const parsed = SignInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    // Always attached to the password field, whether it was the email or the password
    // that was wrong, so the placement itself never confirms an account exists.
    return {
      ok: false,
      code: 'validation',
      message: SIGNIN_FAILED,
      fieldErrors: { password: SIGNIN_FAILED },
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, code: 'unexpected', message: 'Sign-in did not complete. Try again.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || !isStaffRole(profile.role)) {
    await supabase.auth.signOut()
    return denied()
  }

  redirect('/admin')
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/admin/sign-in')
}

// ---------------------------------------------------------------------------
// Listing fields
// ---------------------------------------------------------------------------

/**
 * Creates a listing as a `list` entry. Status is not a form field — every listing starts
 * unpublished and only the lifecycle moves it, which is what makes the approval step
 * mean anything.
 */
export async function createListing(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const raw = listingFieldsFrom(formData)
  const parsed = CreateListingSchema.safeParse(raw)
  if (!parsed.success) return invalid(parsed.error, submittedValues(raw))

  const supabase = await createClient()
  const base = slugify(parsed.data.title)

  let slug = base
  let listingId: string | null = null

  // Two clerks can type the same title in the same minute. Rather than lock the table,
  // let the unique index be the arbiter and try again with a suffix.
  for (let attempt = 0; attempt < 4 && !listingId; attempt += 1) {
    const { data, error } = await supabase
      .from('listings')
      .insert({ ...parsed.data, slug, status: 'list', created_by: user.id })
      .select('id')
      .single()

    if (!error) {
      listingId = data.id
      break
    }
    if (error.code === FK_VIOLATION) {
      return {
        ok: false,
        code: 'validation',
        message: 'That town is no longer in the list.',
        fieldErrors: { town_id: 'Choose a town from the list.' },
        values: submittedValues(raw),
      }
    }
    if (error.code === RLS_DENIED) return denied()
    // Both unique indexes an admin can trip raise 23505, and only one of them is worth
    // retrying. A property-number clash is the clerk's to resolve — retrying it with a
    // fresh slug would fail four more times and then report a title collision that never
    // happened.
    if (isPropertyNoConflict(error)) {
      return {
        ok: false,
        code: 'conflict',
        message: PROPERTY_NO_TAKEN,
        fieldErrors: { property_no: PROPERTY_NO_TAKEN },
        values: submittedValues(raw),
      }
    }
    if (error.code !== UNIQUE_VIOLATION) throw error
    slug = `${base}-${randomSlugSuffix()}`
  }

  if (!listingId) {
    return {
      ok: false,
      code: 'conflict',
      message: 'Could not find a free web address for that title. Change the title slightly and try again.',
      fieldErrors: { title: 'This title collides with an existing listing.' },
      values: submittedValues(raw),
    }
  }

  revalidateAdmin(listingId)
  redirect(`/admin/listings/${listingId}`)
}

/**
 * Saves the listing's own fields, in any status.
 *
 * Editing a live listing's price is a real, frequent flow — the price trigger records
 * it in `price_history` on its own, so this action must not write that row itself or
 * the history would double up. Only STATUS changes are gated, and they go through
 * `transitionListing`.
 *
 * Concurrent edits are last-write-wins by decision this release: two staff saving the
 * same listing leaves the second value, and both appear in `price_history`.
 */
export async function updateListing(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const raw = { ...listingFieldsFrom(formData), slug: formData.get('slug') }
  const parsed = UpdateListingSchema.safeParse({
    ...raw,
    listingId: formData.get('listingId'),
  })
  if (!parsed.success) return invalid(parsed.error, submittedValues(raw))

  const { listingId, slug, ...fields } = parsed.data
  const supabase = await createClient()

  const { data: current, error: readError } = await supabase
    .from('listings')
    .select('id, slug, status')
    .eq('id', listingId)
    .maybeSingle()

  if (readError) throw readError
  if (!current) return { ok: false, code: 'not_found', message: 'That listing no longer exists.' }

  const slugEditable = current.status === 'list' || current.status === 'for_approval'
  const slugChanged = slug !== null && slug !== current.slug

  if (slugChanged && !slugEditable) {
    return {
      ok: false,
      code: 'precondition',
      message: 'The web address is fixed once a listing has been published.',
      fieldErrors: {
        slug: `A ${STATUS_LABELS[current.status].toLowerCase()} listing keeps its web address so existing links keep working.`,
      },
      values: submittedValues(raw),
    }
  }

  const nextSlug = slugChanged && slug ? slug : current.slug
  const patch = slugChanged ? { ...fields, slug: nextSlug } : fields

  const { error } = await supabase.from('listings').update(patch).eq('id', listingId)

  if (error) {
    // Checked before the slug branch: the two share SQLSTATE 23505, and the slug message
    // is the fallback only because it is the one that was already here.
    if (isPropertyNoConflict(error)) {
      return {
        ok: false,
        code: 'conflict',
        message: PROPERTY_NO_TAKEN,
        fieldErrors: { property_no: PROPERTY_NO_TAKEN },
        values: submittedValues(raw),
      }
    }
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        code: 'conflict',
        message: 'Another listing already uses that web address.',
        fieldErrors: { slug: 'Another listing already uses that web address.' },
        values: submittedValues(raw),
      }
    }
    if (error.code === FK_VIOLATION) {
      return {
        ok: false,
        code: 'validation',
        message: 'That town is no longer in the list.',
        fieldErrors: { town_id: 'Choose a town from the list.' },
        values: submittedValues(raw),
      }
    }
    if (error.code === RLS_DENIED) return denied()
    throw error
  }

  revalidateAdmin(listingId)
  if (isPublicStatus(current.status)) revalidatePublic(nextSlug)

  return { ok: true, message: 'Listing saved.' }
}

const FeaturesSchema = z.object({
  listingId: z.uuid({ error: 'That listing could not be identified.' }),
  featureIds: z.array(z.uuid({ error: 'One of the features was not recognised.' })),
})

/**
 * Replaces the whole feature set. An empty submission means "none" — a form that
 * silently ignored an all-unchecked save would make removing the last feature
 * impossible.
 */
export async function saveListingFeatures(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const parsed = FeaturesSchema.safeParse({
    listingId: formData.get('listingId'),
    featureIds: formData.getAll('featureIds'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const { listingId, featureIds } = parsed.data
  const supabase = await createClient()

  const { data: listing, error: readError } = await supabase
    .from('listings')
    .select('id, slug, status')
    .eq('id', listingId)
    .maybeSingle()

  if (readError) throw readError
  if (!listing) return { ok: false, code: 'not_found', message: 'That listing no longer exists.' }

  const { error: clearError } = await supabase
    .from('listing_features')
    .delete()
    .eq('listing_id', listingId)

  if (clearError) {
    if (clearError.code === RLS_DENIED) return denied()
    throw clearError
  }

  const unique = [...new Set(featureIds)]
  if (unique.length) {
    const { error } = await supabase
      .from('listing_features')
      .insert(unique.map((featureId) => ({ listing_id: listingId, feature_id: featureId })))

    if (error) {
      if (error.code === FK_VIOLATION) {
        return {
          ok: false,
          code: 'validation',
          message: 'One of those features no longer exists. Reload the page and try again.',
        }
      }
      if (error.code === RLS_DENIED) return denied()
      throw error
    }
  }

  revalidateAdmin(listingId)
  if (isPublicStatus(listing.status)) revalidatePublic(listing.slug)

  return {
    ok: true,
    message: unique.length ? `Saved ${unique.length} feature${unique.length === 1 ? '' : 's'}.` : 'Features cleared.',
  }
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

const AddPhotoSchema = z.object({
  listingId: z.uuid({ error: 'That listing could not be identified.' }),
  storagePath: z.string({ error: 'The upload did not report where it landed.' }).min(1),
  altText: z.preprocess(blankToNull, z.string().trim().max(200).nullable()).optional(),
})

/**
 * Records a photo the browser has already uploaded.
 *
 * The bytes never pass through here — a server action body is capped at 1 MB, so the
 * browser writes straight to Storage under its own staff session and then calls this
 * to create the row. Which means this action has to verify two things it cannot see
 * directly: that the path really belongs to this listing, and that an object is
 * actually sitting at it. Without the second check a tampered call would create a row
 * pointing at nothing, and the listing would publish with a broken image.
 */
export async function addListingPhoto(input: {
  listingId: string
  storagePath: string
  altText?: string | null
}): Promise<ActionResult<{ photoId: string }>> {
  const user = await getStaffUser()
  if (!user) return denied()

  const parsed = AddPhotoSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const { listingId, storagePath, altText } = parsed.data
  const supabase = await createClient()

  const { data: listing, error: readError } = await supabase
    .from('listings')
    .select('id, slug, status')
    .eq('id', listingId)
    .maybeSingle()

  if (readError) throw readError
  if (!listing) return { ok: false, code: 'not_found', message: 'That listing no longer exists.' }

  // A withdrawn listing's photos are already in the public bucket, so a new upload
  // would be published the moment it landed. Relisting first is the honest order.
  if (listing.status === 'withdrawn') {
    return {
      ok: false,
      code: 'precondition',
      message: 'Relist this property before adding photos — anything uploaded now would be public straight away.',
    }
  }

  if (!isValidPhotoPath(storagePath, listingId)) {
    return {
      ok: false,
      code: 'validation',
      message: 'That file path does not belong to this listing.',
    }
  }

  const bucket = bucketForStatus(listing.status)
  const { data: present } = await supabase.storage.from(bucket).exists(storagePath)
  if (present !== true) {
    // A half-finished publish can leave objects in the other bucket; look there before
    // declaring the upload lost.
    const { data: elsewhere } = await supabase.storage.from(otherBucket(bucket)).exists(storagePath)
    if (elsewhere !== true) {
      return {
        ok: false,
        code: 'storage',
        message: 'The uploaded file was not found in storage. Try uploading it again.',
      }
    }
  }

  const { data: existing, error: photosError } = await supabase
    .from('listing_photos')
    .select('id, sort_order, is_primary')
    .eq('listing_id', listingId)

  if (photosError) throw photosError

  // The cover invariant is `is_primary === (sort_order === 0)`, so the first photo of a
  // listing is its cover and every later one goes on the end.
  const isFirst = existing.length === 0
  const sortOrder = isFirst ? 0 : Math.max(...existing.map((photo) => photo.sort_order)) + 1

  const { data: inserted, error } = await supabase
    .from('listing_photos')
    .insert({
      listing_id: listingId,
      storage_path: storagePath,
      alt_text: altText ?? null,
      sort_order: sortOrder,
      is_primary: isFirst,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // Two first uploads racing for the cover slot. One of them wins; the other asks
      // for a reload rather than quietly landing without a cover.
      return {
        ok: false,
        code: 'conflict',
        message: 'Another photo became the cover at the same moment. Reload the page and add this one again.',
      }
    }
    if (error.code === RLS_DENIED) return denied()
    throw error
  }

  revalidateAdmin(listingId)
  if (isPublicStatus(listing.status)) revalidatePublic(listing.slug)

  return { ok: true, message: 'Photo added.', data: { photoId: inserted.id } }
}

const PhotoMetaSchema = z.object({
  listingId: z.uuid({ error: 'That listing could not be identified.' }),
  photoId: z.uuid({ error: 'That photo could not be identified.' }),
  altText: z.preprocess(
    blankToNull,
    z.string().trim().max(200, { error: 'Keep the description under 200 characters.' }).nullable()
  ),
})

/** Alt text only. Blank clears it — it is never a publish precondition. */
export async function updatePhotoMeta(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const parsed = PhotoMetaSchema.safeParse({
    listingId: formData.get('listingId'),
    photoId: formData.get('photoId'),
    altText: formData.get('altText'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const { listingId, photoId, altText } = parsed.data
  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('listing_photos')
    .update({ alt_text: altText })
    .eq('id', photoId)
    .eq('listing_id', listingId)
    .select('id')

  if (error) {
    if (error.code === RLS_DENIED) return denied()
    throw error
  }
  if (!updated.length) return { ok: false, code: 'not_found', message: 'That photo no longer exists.' }

  const listing = await readListingForRevalidate(supabase, listingId)
  revalidateAdmin(listingId)
  if (listing && isPublicStatus(listing.status)) revalidatePublic(listing.slug)

  return { ok: true, message: 'Photo description saved.' }
}

const ReorderSchema = z.object({
  listingId: z.uuid({ error: 'That listing could not be identified.' }),
  photoIds: z.array(z.uuid()).min(1, { error: 'Send the whole photo order.' }),
})

/** Both reorder paths say the same thing, because to the clerk it is the same thing. */
const REORDER_CONFLICT =
  'The photos changed while you were reordering them. Reload the page and try again.'

/**
 * `reorder_listing_photos`, reached through a cast.
 *
 * `lib/database.types.ts` is generated from the schema and was generated before this
 * function existed; regenerating it is a separate job with its own review. The cast is
 * deliberately narrow — one call, arguments and return type written out — so if the
 * function's signature ever changes, the break shows up here instead of leaking `any`
 * across the module.
 */
type ReorderRpcClient = {
  rpc(
    fn: 'reorder_listing_photos',
    args: { p_listing_id: string; p_photo_ids: string[] }
  ): PromiseLike<{ data: number | null; error: { code: string; message: string } | null }>
}

/**
 * Writes a whole photo order in one transaction.
 *
 * This used to be five sequential round trips — clear the primaries, write each
 * sort_order, set the new primary. On a hosted database that sequence is long enough to
 * be *seen*: a page loaded mid-write showed the listing with no cover and stale
 * positions, and a reorder computed from that torn read wrote a wrong order. Measured,
 * not theorised. One function call makes an observer see either the old order or the new
 * one, and nothing in between.
 *
 * The function is SECURITY INVOKER, so row-level security still decides whether the
 * writes land. It returns -1 when the submitted id set is not exactly the listing's
 * current photos, and otherwise the number of rows it wrote — so a short count (a
 * non-staff caller matching nothing, or a photo that vanished mid-call) is the same
 * answer as a mismatch: what you were looking at is no longer what is there.
 */
async function applyPhotoOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  listingId: string,
  photoIds: string[]
): Promise<ActionResult> {
  const { data: written, error } = await (supabase as unknown as ReorderRpcClient).rpc(
    'reorder_listing_photos',
    { p_listing_id: listingId, p_photo_ids: photoIds }
  )

  if (error) {
    if (error.code === RLS_DENIED) return denied()
    throw error
  }

  if (written !== photoIds.length) {
    return { ok: false, code: 'conflict', message: REORDER_CONFLICT }
  }

  return { ok: true }
}

/**
 * Rewrites the whole order in one call.
 *
 * The submitted list must be exactly the listing's current photos: if someone else added
 * or deleted one while this page was open, applying a stale order would drop a photo out
 * of sequence or renumber a row that no longer exists. Better to say so. That check now
 * happens inside the same transaction as the writes rather than as a read beforehand —
 * see `applyPhotoOrder` for why the two cannot be separate.
 */
export async function reorderPhotos(input: {
  listingId: string
  photoIds: string[]
}): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const parsed = ReorderSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const { listingId, photoIds } = parsed.data
  const supabase = await createClient()

  const applied = await applyPhotoOrder(supabase, listingId, photoIds)
  if (!applied.ok) return applied

  const listing = await readListingForRevalidate(supabase, listingId)
  revalidateAdmin(listingId)
  if (listing && isPublicStatus(listing.status)) revalidatePublic(listing.slug)

  return { ok: true, message: 'Photo order saved.' }
}

const PhotoRefSchema = z.object({
  listingId: z.uuid({ error: 'That listing could not be identified.' }),
  photoId: z.uuid({ error: 'That photo could not be identified.' }),
})

/**
 * Makes one photo the cover.
 *
 * The cover invariant is `is_primary === (sort_order === 0)`, which makes "make this the
 * cover" and "move this to the front" the same operation — so this goes through the same
 * single-transaction reorder, with the target first and everything else keeping its
 * relative order behind it.
 *
 * That is what keeps AC-17(a) true: there is no instant where two rows claim the cover
 * and no instant where none does, so the partial unique index never surfaces to the user
 * and no reader ever sees a listing that has momentarily lost its cover.
 */
export async function setPrimaryPhoto(input: {
  listingId: string
  photoId: string
}): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const parsed = PhotoRefSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const { listingId, photoId } = parsed.data
  const supabase = await createClient()

  // Read in the same order the edit page renders, so "keeps its relative order" means
  // the order the clerk was actually looking at.
  const { data: photos, error: readError } = await supabase
    .from('listing_photos')
    .select('id')
    .eq('listing_id', listingId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (readError) throw readError
  if (!photos.some((photo) => photo.id === photoId)) {
    return { ok: false, code: 'not_found', message: 'That photo no longer exists.' }
  }

  const photoIds = [photoId, ...photos.filter((photo) => photo.id !== photoId).map((photo) => photo.id)]

  // A photo added between the read and the write makes the id set disagree, and the
  // function refuses rather than writing an order that is already out of date.
  const applied = await applyPhotoOrder(supabase, listingId, photoIds)
  if (!applied.ok) return applied

  const listing = await readListingForRevalidate(supabase, listingId)
  revalidateAdmin(listingId)
  if (listing && isPublicStatus(listing.status)) revalidatePublic(listing.slug)

  return { ok: true, message: 'Cover photo updated.' }
}

/**
 * Deletes a photo, row and file.
 *
 * The row goes first: a row with no file renders as a placeholder the clerk can delete
 * again, whereas a file with no row is invisible from the admin and still served on the
 * internet. If the file cannot be removed the result is still a success — the row is
 * gone — but it carries a warning that names the path and says plainly that the image
 * may still be reachable, because that is the sentence someone needs in order to act.
 */
export async function deletePhoto(input: {
  listingId: string
  photoId: string
}): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const parsed = PhotoRefSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const { listingId, photoId } = parsed.data
  const supabase = await createClient()

  const { data: listing, error: listingError } = await supabase
    .from('listings')
    .select('id, slug, status')
    .eq('id', listingId)
    .maybeSingle()

  if (listingError) throw listingError
  if (!listing) return { ok: false, code: 'not_found', message: 'That listing no longer exists.' }

  const { data: photos, error: photosError } = await supabase
    .from('listing_photos')
    .select('id, storage_path, sort_order, is_primary, created_at')
    .eq('listing_id', listingId)

  if (photosError) throw photosError

  const target = photos.find((photo) => photo.id === photoId)
  if (!target) return { ok: false, code: 'not_found', message: 'That photo has already been deleted.' }

  // A live listing with no photo renders as an empty grey card on the public site.
  if (listing.status === 'live' && photos.length === 1) {
    return {
      ok: false,
      code: 'precondition',
      message: 'A live listing has to keep at least one photo. Withdraw it first, or upload a replacement before deleting this one.',
    }
  }

  const { data: deleted, error: deleteError } = await supabase
    .from('listing_photos')
    .delete()
    .eq('id', photoId)
    .eq('listing_id', listingId)
    .select('id')

  if (deleteError) {
    if (deleteError.code === RLS_DENIED) return denied()
    throw deleteError
  }
  if (!deleted.length) {
    return { ok: false, code: 'not_found', message: 'That photo has already been deleted.' }
  }

  // Deleting the cover promotes the next photo, so a listing with photos can never be
  // publish-blocked on a cover that simply is not there any more.
  const remaining = photos
    .filter((photo) => photo.id !== photoId)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))

  if (target.is_primary && remaining.length) {
    await supabase
      .from('listing_photos')
      .update({ is_primary: false })
      .eq('listing_id', listingId)
      .eq('is_primary', true)

    for (const [index, photo] of remaining.entries()) {
      await supabase
        .from('listing_photos')
        .update({ sort_order: index })
        .eq('id', photo.id)
        .eq('listing_id', listingId)
    }

    await supabase
      .from('listing_photos')
      .update({ is_primary: true })
      .eq('id', remaining[0].id)
      .eq('listing_id', listingId)
  }

  const removal = await removePhotoObject(
    supabase,
    target.storage_path,
    bucketForStatus(listing.status)
  )

  revalidateAdmin(listingId)
  if (isPublicStatus(listing.status)) revalidatePublic(listing.slug)

  if (!removal.ok) {
    return {
      ok: true,
      message: 'Photo removed from the listing.',
      warning: `The file ${target.storage_path} could not be deleted from storage${
        removal.reason ? ` (${removal.reason})` : ''
      }. It may still be reachable by its public link — tell whoever administers the Supabase project.`,
    }
  }

  return { ok: true, message: 'Photo deleted.' }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const TransitionSchema = z.object({
  listingId: z.uuid({ error: 'That listing could not be identified.' }),
  to: StatusEnum,
  /** The status the page was showing. Turns a blind update into a compare-and-set. */
  expectedFrom: StatusEnum,
})

/**
 * Moves a listing through the lifecycle.
 *
 * The order of the steps is the whole point:
 *
 * 1. `expectedFrom` is compared against the stored status, so two staff acting on the
 *    same listing cannot both "succeed" — the second is told to reload.
 * 2. The graph is checked before anything else, so `list → live` is refused here and
 *    never reaches the database at all. `guard_listing_publish` enforces the same graph
 *    underneath, for the callers that never come through this action.
 * 3. Publish preconditions are evaluated with the same function the edit page uses to
 *    list them, so the message names the missing piece instead of failing generically.
 * 4. Photos move to the public bucket and are verified present *before* the status
 *    flips. A live listing whose images 404 is worse than a publish that did not happen.
 * 5. The flip is a guarded update. Zero rows means the status moved under us.
 */
export async function transitionListing(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const parsed = TransitionSchema.safeParse({
    listingId: formData.get('listingId'),
    to: formData.get('to'),
    expectedFrom: formData.get('expectedFrom'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const { listingId, to, expectedFrom } = parsed.data
  const supabase = await createClient()

  const listingResult = await supabase
    .from('listings')
    .select('id, slug, status, listing_photos ( storage_path, is_primary )')
    .eq('id', listingId)
    .maybeSingle()

  if (listingResult.error) throw listingResult.error
  if (!listingResult.data) return { ok: false, code: 'not_found', message: 'That listing no longer exists.' }

  const listing = listingResult.data as unknown as {
    id: string
    slug: string
    status: ListingStatus
    listing_photos: { storage_path: string; is_primary: boolean }[]
  }

  if (listing.status !== expectedFrom) {
    return {
      ok: false,
      code: 'conflict',
      message: `Someone else moved this listing to ${STATUS_LABELS[listing.status]} while you had it open. Reload the page to see where it stands.`,
    }
  }

  if (!TRANSITIONS[expectedFrom].includes(to)) {
    return {
      ok: false,
      code: 'precondition',
      message:
        expectedFrom === 'sold'
          ? 'A sold listing is final — its status cannot be changed from here.'
          : `A ${STATUS_LABELS[expectedFrom].toLowerCase()} listing cannot go straight to ${STATUS_LABELS[to].toLowerCase()}.`,
    }
  }

  if (to === 'live') {
    const blockers = publishBlockersFor({
      photoCount: listing.listing_photos.length,
      primaryCount: listing.listing_photos.filter((photo) => photo.is_primary).length,
    })
    if (blockers.length) {
      return {
        ok: false,
        code: 'precondition',
        message: `This listing cannot go live yet: ${blockers.join(' ')}`,
      }
    }
  }

  let movedPaths: string[] = []

  if (to === 'live') {
    const paths = listing.listing_photos.map((photo) => photo.storage_path)
    const report = await movePhotosToPublic(supabase, paths)
    if (!report.ok) {
      return {
        ok: false,
        code: 'storage',
        message: `Publishing stopped because these photos could not be moved to the public bucket: ${report.failed.join(
          ', '
        )}. Nothing was published — try again.`,
      }
    }
    movedPaths = report.moved
  }

  const { data: flipped, error: flipError } = await supabase
    .from('listings')
    .update({ status: to })
    .eq('id', listingId)
    .eq('status', expectedFrom)
    .select('id, slug')

  if (flipError) {
    const compensation = await compensateMovedPhotos(supabase, movedPaths)
    // `guard_listing_publish` is the backstop for the lifecycle graph; it raises a check
    // violation, which is a precondition failure and not a system fault.
    if (flipError.code === CHECK_VIOLATION || flipError.code === RAISE_EXCEPTION) {
      return {
        ok: false,
        code: 'precondition',
        message: `The database refused that move: ${flipError.message}${compensation}`,
      }
    }
    if (flipError.code === RLS_DENIED) return denied()
    throw flipError
  }

  if (!flipped.length) {
    const compensation = await compensateMovedPhotos(supabase, movedPaths)
    return {
      ok: false,
      code: 'conflict',
      message: `Someone else changed this listing's status at the same moment. Reload the page to see where it stands.${compensation}`,
    }
  }

  revalidateAdmin(listingId)
  revalidatePublic(flipped[0].slug)

  /**
   * Saved-request alerts, after the response has gone back to the clerk.
   *
   * Publishing is the statutory act; mailing people about it is a courtesy on top. So
   * it runs in `after()` — outside this action's result entirely — and `sendMatchAlerts`
   * itself never throws. A mail provider having a bad afternoon cannot turn a successful
   * publish into an error on this screen, and nothing below this line can change what
   * this function returns.
   *
   * Withdraw → relist fires it again for the same listing, which is safe: the alert
   * table's primary key is (request_id, listing_id) and the insert ignores duplicates,
   * so the second run only picks up requests filed since the first.
   */
  if (to === 'live') after(() => sendMatchAlerts(listingId))

  return { ok: true, message: `Listing moved to ${STATUS_LABELS[to]}.` }
}

/**
 * One best-effort pass to put the photos back where the status says they belong.
 *
 * Exactly one attempt: this runs while the caller is already reporting a failure, and
 * a retry loop here would only postpone the message the clerk needs. Whatever it could
 * not move is named in the returned sentence so a person can finish the job.
 */
async function compensateMovedPhotos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  movedPaths: string[]
): Promise<string> {
  if (!movedPaths.length) return ''

  const back = await movePhotosToDraft(supabase, movedPaths)
  if (back.ok) return ' The photos were moved back to the private bucket.'

  return ` These photos are still sitting in the public bucket and may be reachable by their direct link: ${back.failed.join(
    ', '
  )}. Tell whoever administers the Supabase project.`
}

// ---------------------------------------------------------------------------
// Property requests
// ---------------------------------------------------------------------------

const ToggleRequestSchema = z.object({
  requestId: z.uuid({ error: 'That request could not be identified.' }),
  handled: z.preprocess((value) => value === 'true', z.boolean()),
})

/**
 * Marks a saved property request as dealt with, or puts it back on the pile.
 *
 * Last write wins, deliberately: two staff ticking the same row mean the same thing, and
 * a compare-and-set here would only produce a "reload the page" message for an outcome
 * both of them wanted. Nothing statutory hangs on the flag — it is a worklist marker.
 *
 * It is not cosmetic, though: `is_handled` is also what takes a request out of the match
 * candidate set, so ticking it stops that person's alerts. The unsubscribe link sets the
 * same column through its own function.
 */
export async function toggleRequestHandled(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const parsed = ToggleRequestSchema.safeParse({
    requestId: formData.get('requestId'),
    handled: formData.get('handled'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const { requestId, handled } = parsed.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('property_requests')
    .update({ is_handled: handled })
    .eq('id', requestId)
    .select('id')

  if (error) {
    if (error.code === RLS_DENIED) return denied()
    throw error
  }

  if (!data.length) {
    return { ok: false, code: 'not_found', message: 'That request no longer exists.' }
  }

  revalidatePath('/admin/requests')

  return {
    ok: true,
    message: handled ? 'Marked as handled.' : 'Put back on the open list.',
  }
}

// ---------------------------------------------------------------------------
// Admin accounts (super admin only)
// ---------------------------------------------------------------------------

/**
 * Both actions below differ from every other action in this file in exactly one way:
 * they open with `getSuperAdmin()` instead of `getStaffUser()`. Everything else — the
 * uniform denial, the zod parse, the posted values handed back, the error codes mapped
 * by SQLSTATE and never by message — is the same, on purpose.
 *
 * Neither is the security boundary. `create_admin_invite` and `revoke_staff_admin` are
 * SECURITY DEFINER functions that ask `is_super_admin()` themselves and raise 42501 if
 * the answer is no, and the `role` column is not in any UPDATE grant `authenticated`
 * holds. A staff admin who hand-writes this POST is refused three times over.
 */

/**
 * Invites somebody to become a staff admin.
 *
 * The order of the four steps is the whole design:
 *
 * 1. The database mints the secret. `create_admin_invite` returns 32 random bytes hex
 *    encoded and stores only their SHA-256 hash, so the raw token exists exactly twice —
 *    in this function's local variable and, a moment later, in the invitee's mailbox.
 * 2. The email is AWAITED, not handed to `after()`. Everywhere else in this file mail is
 *    a courtesy hung off a write that already succeeded, so `after()` is right. Here the
 *    email IS the deliverable: an invitation nobody received is not an invitation, and
 *    the person who typed the address has to be told so while they are still looking at
 *    the form.
 * 3. A failed send is reported as a failure. `sendEmail` returns false and never throws,
 *    so this branch is real and cannot be skipped by assuming success.
 * 4. Nothing about the token reaches the return value. See `lib/admin/invites.ts`.
 */
export async function inviteAdmin(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getSuperAdmin()
  if (!user) return denied()

  const raw = { email: formData.get('email') }
  const parsed = InviteAdminSchema.safeParse(raw)
  if (!parsed.success) return invalid(parsed.error, submittedValues(raw))

  const { email } = parsed.data
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('create_admin_invite', { invite_email: email })

  if (error) {
    switch (classifyInviteError(error.code)) {
      case 'denied':
        return denied()
      case 'refused':
        // No field error: 23514 is raised both for an address the database refused and
        // for a concurrent double-submit, and marking the field invalid would assert the
        // first when it may well have been the second.
        return {
          ok: false,
          code: 'conflict',
          message: INVITE_REFUSED,
          values: submittedValues(raw),
        }
      case 'duplicate':
        return {
          ok: false,
          code: 'conflict',
          message: INVITE_DUPLICATE,
          values: submittedValues(raw),
        }
      default:
        // A fault, not something the person at the keyboard can fix. The global handler
        // logs it; the error object carries no token, only a code and a message.
        throw error
    }
  }

  // `returns table (...)` arrives as an array. No row means the function did not do what
  // its contract says, which is a fault rather than a message on a form.
  const invite = data?.[0]
  if (!invite) throw new Error('create_admin_invite returned no row')

  /**
   * `invite.invite_token` IS in this response and is deliberately never read.
   *
   * The database still mints a 256-bit secret and stores its hash, because
   * `admin_invites.token_hash` is NOT NULL and that column is what makes an invitation a
   * row rather than a wish. But since the self-service door was retired there is nothing
   * a raw token can do — `redeem_admin_invite` is no longer callable by anybody — so it
   * is not emailed, not put in a cookie, not put in a URL and not logged. It reaches this
   * variable and is discarded with it at the end of the request.
   *
   * The link is the same for every invitation and carries no secret and no address: the
   * invitation is matched to the person later by the address they sign up with.
   */
  const delivered = await sendEmail({
    to: email,
    subject: INVITE_SUBJECT,
    text: inviteEmailBody({
      link: inviteLandingLink(),
      expiresLabel: stampLabel(invite.invite_expires_at),
    }),
  })

  revalidatePath('/admin/admins')

  return describeInviteSend(email, delivered, submittedValues(raw))
}

/**
 * Takes admin access away from a staff account.
 *
 * The demotion target becomes a `buyer` rather than being deleted: revoking a privilege
 * must not destroy a person's account, their favourites or their history. The function
 * refuses to touch an `admin` row and refuses to touch the caller's own, so this control
 * cannot empty the owner tier and lock everybody out of invites and demotions.
 *
 * `no_change` comes back as a conflict, not as a success. Both of the situations that
 * produce it — the row is not a staff admin any more, or it is the caller's own — mean
 * the list on the screen is out of date, and saying "done" to either would be a lie.
 */
export async function demoteAdmin(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getSuperAdmin()
  if (!user) return denied()

  const parsed = DemoteAdminSchema.safeParse({ profileId: formData.get('profileId') })
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()

  const { data, error } = await supabase.rpc('revoke_staff_admin', {
    target_id: parsed.data.profileId,
  })

  if (error) {
    if (classifyRevokeError(error.code) === 'denied') return denied()
    throw error
  }

  revalidatePath('/admin/admins')

  return describeRevokeOutcome(data)
}

/**
 * The two approval-queue functions, reached through a cast.
 *
 * Same narrow, one-purpose shape as `ReorderRpcClient` above, and for the same reason:
 * `lib/database.types.ts` is generated from the live schema, and
 * `supabase/migrations/20260802204500_admin_invite_approval_queue.sql` is written but NOT
 * applied, so the generator has never seen these two. Regenerating the types belongs to
 * the apply, not to this change. The cast names both functions, their one argument and
 * their return type, so a signature change breaks here instead of leaking `any` across
 * the module — and until the migration is applied both calls come back as PGRST202,
 * which `classifyDecisionError` treats as the fault it is.
 */
type InviteDecisionRpcClient = {
  rpc(
    fn: 'approve_admin_invite' | 'decline_admin_invite',
    args: { invite_id: string }
  ): PromiseLike<{ data: string | null; error: { code: string; message: string } | null }>
}

/**
 * Grants admin access to somebody who was invited and has since confirmed an account.
 *
 * THIS IS THE ONLY PATH IN THE PRODUCT THAT GRANTS A ROLE FROM AN INVITATION, and it runs
 * only when the owner presses the button. Two earlier designs completed the promotion
 * automatically once the invited address held a confirmed account; both were rejected,
 * and the reasoning is written out at the top of the migration. Nothing here may be turned
 * into a callback, a sign-in hook or a redirect side effect.
 *
 * The form posts one field and it is the INVITATION's id, never an account id. The
 * database re-reads the invitation under a row lock, re-checks that it is still pending
 * and unexpired, and resolves the account from the invitation's own address inside the
 * function — so a stale queue, a doctored form or a replayed POST cannot aim this at a
 * person the owner never saw. This action is not the security boundary either:
 * `approve_admin_invite` asks `is_super_admin()` itself and raises 42501 if the answer is
 * no, and `role` is not in any grant an API caller holds.
 *
 * Everything that is not a grant comes back as a STATUS, not an exception — expired,
 * already dealt with, no confirmed account, already an owner — because each of those is a
 * different sentence the owner can act on, and none of them is a fault.
 */
export async function approveAdminInvite(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getSuperAdmin()
  if (!user) return denied()

  const parsed = InviteDecisionSchema.safeParse({ inviteId: formData.get('inviteId') })
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()

  const { data, error } = await (supabase as unknown as InviteDecisionRpcClient).rpc(
    'approve_admin_invite',
    { invite_id: parsed.data.inviteId }
  )

  if (error) {
    if (classifyDecisionError(error.code) === 'denied') return denied()
    // A fault, not something the person at the keyboard can fix. The global handler logs
    // it; nothing about the invitation is put on the screen.
    throw error
  }

  revalidatePath('/admin/admins')

  if (data !== 'approved') return describeApproveOutcome(data)

  /**
   * The courtesy email, AFTER the grant and outside it.
   *
   * The role was written inside one database transaction that has already committed. So
   * everything from here down is allowed to fail without changing what happened: a mail
   * provider having a bad afternoon must never be able to undo an access decision, and
   * nothing below may return a result that says the approval did not happen.
   *
   * The address is re-read from the row rather than taken from the form. The browser
   * posted an invitation id and nothing else; letting it post the address instead would
   * turn this screen into a way to make the site send mail to any address at all. The
   * read is authorised by the same super-admin SELECT policy the queue uses, and the
   * column-scoped grant on `admin_invites` covers `email`.
   *
   * `await`ed rather than handed to `after()`: unlike the match alerts, this one has a
   * consequence the owner has to see. If it did not go out, the only person who can tell
   * the new admin is the owner, and they have to be told so while they are still looking
   * at the screen.
   */
  const { data: invite } = await supabase
    .from('admin_invites')
    .select('email')
    .eq('id', parsed.data.inviteId)
    .maybeSingle()

  const delivered = invite?.email
    ? await sendEmail({
        to: invite.email,
        subject: APPROVAL_SUBJECT,
        text: approvalEmailBody(),
      })
    : false

  return describeApproveOutcome(data, delivered)
}

/**
 * Cancels a pending invitation — the recall this product has never had.
 *
 * It works on ANY pending invitation, not only the ones waiting in the queue: an
 * invitation sent to a mistyped address, or one that was never delivered, is exactly the
 * one that most needs recalling, and until now the only remedy was hand-written SQL or
 * waiting seven days for it to expire.
 *
 * Nobody's role changes, so nothing is written to the access record — the cancellation
 * lives on the invitation itself, with who did it and when.
 */
export async function declineAdminInvite(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getSuperAdmin()
  if (!user) return denied()

  const parsed = InviteDecisionSchema.safeParse({ inviteId: formData.get('inviteId') })
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()

  const { data, error } = await (supabase as unknown as InviteDecisionRpcClient).rpc(
    'decline_admin_invite',
    { invite_id: parsed.data.inviteId }
  )

  if (error) {
    if (classifyDecisionError(error.code) === 'denied') return denied()
    throw error
  }

  revalidatePath('/admin/admins')

  return describeDeclineOutcome(data)
}

/** The slug and status a revalidation needs, read after a write that did not return them. */
async function readListingForRevalidate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  listingId: string
): Promise<{ slug: string; status: ListingStatus } | null> {
  const { data } = await supabase
    .from('listings')
    .select('slug, status')
    .eq('id', listingId)
    .maybeSingle()
  return data ?? null
}
