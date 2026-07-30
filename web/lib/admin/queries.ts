import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { bucketForStatus, displayUrls, type PhotoBucket } from '@/lib/admin/photos'
import { labelFromDb, type DbCategory } from '@/lib/categories'
import { peso } from '@/lib/format'
import type { Database } from '@/lib/database.types'

/**
 * Everything the admin screens read. Pages never touch the Supabase client
 * themselves, exactly as the public site does it — the difference here is that
 * every exported function opens with `requireStaff()`.
 *
 * That guard is not belt-and-braces over the layout: a query function is the last
 * place before rows leave the database, and it is the only place that still holds
 * when a future route, action or route handler calls it. The layout above only
 * decides what a browser sees.
 *
 * The lifecycle graph and the publish preconditions also live here, so the page that
 * *shows* the blockers and the action that *enforces* them read the same predicate.
 * Keeping them here rather than in `app/admin/actions.ts` avoids an import cycle
 * (actions already import this module) and keeps `'use server'` free of the
 * non-async exports it forbids.
 */

type ListingStatus = Database['public']['Enums']['listing_status']
type VerificationKind = Database['public']['Enums']['verification_kind']

export const ADMIN_PAGE_SIZE = 25

/** PostgREST's code for "you asked for rows past the end of the table". */
const RANGE_NOT_SATISFIABLE = 'PGRST103'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const STATUS_LABELS: Record<ListingStatus, string> = {
  draft: 'Draft',
  verifying: 'Verifying',
  live: 'Live',
  sold: 'Sold',
  withdrawn: 'Withdrawn',
}

export const STATUS_ORDER: ListingStatus[] = ['draft', 'verifying', 'live', 'sold', 'withdrawn']

export const KIND_LABELS: Record<VerificationKind, string> = {
  title_check: 'Title check',
  ground_validation: 'Ground validation',
  published: 'Published',
}

/**
 * The one clock the whole admin uses. Rows are stored in UTC and read back in the
 * time zone the staff actually work in, so "recorded at 9:14 AM" means what the
 * person who recorded it remembers — which is the whole point of an audit trail.
 */
const MANILA_STAMP = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function stampLabel(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : MANILA_STAMP.format(date)
}

/**
 * The lifecycle graph. `sold` is terminal on purpose: a closed sale is a statement
 * about the world, and un-selling a property is a correction someone has to make
 * deliberately in the database, not a button a tired clerk can reach at 5 PM.
 */
export const TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  draft: ['verifying'],
  verifying: ['draft', 'live'],
  live: ['sold', 'withdrawn'],
  sold: [],
  withdrawn: ['live'],
}

export function transitionLabel(from: ListingStatus, to: ListingStatus): string {
  if (from === 'draft' && to === 'verifying') return 'Submit for verification'
  if (from === 'verifying' && to === 'draft') return 'Send back to draft'
  if (from === 'verifying' && to === 'live') return 'Publish'
  if (from === 'live' && to === 'sold') return 'Mark as sold'
  if (from === 'live' && to === 'withdrawn') return 'Withdraw from the site'
  if (from === 'withdrawn' && to === 'live') return 'Relist'
  return `Move to ${STATUS_LABELS[to]}`
}

export function transitionHint(from: ListingStatus, to: ListingStatus): string {
  if (from === 'draft' && to === 'verifying') return 'Hands it to whoever does the fieldwork.'
  if (from === 'verifying' && to === 'draft') return 'Nothing is published; the listing goes back for edits.'
  if (from === 'verifying' && to === 'live')
    return 'Moves the photos to the public bucket and puts the listing on the site.'
  if (from === 'live' && to === 'sold') return 'Final. The listing stops appearing as available.'
  if (from === 'live' && to === 'withdrawn')
    return 'Takes it off the site. Photos already published stay reachable by their direct link.'
  if (from === 'withdrawn' && to === 'live') return 'Puts it back on the site using the existing verification record.'
  return ''
}

export type PublishCheckInput = {
  titleChecks: number
  groundValidations: number
  photoCount: number
  primaryCount: number
}

/**
 * Why a listing cannot go live yet, in words the person reading them can act on.
 *
 * Both fieldwork kinds are required independently — one visit does not stand in for
 * the other, and the database trigger enforces the same two so this list can never
 * be the only thing between an unverified property and the public site.
 */
export function publishBlockersFor(input: PublishCheckInput): string[] {
  const blockers: string[] = []
  if (input.titleChecks < 1) blockers.push('No title check has been recorded.')
  if (input.groundValidations < 1) blockers.push('No ground validation has been recorded.')
  if (input.photoCount < 1) blockers.push('The listing has no photos.')
  else if (input.primaryCount !== 1) blockers.push('No cover photo has been chosen.')
  return blockers
}

export const ADMIN_SORTS = {
  updated: { label: 'Recently changed', column: 'updated_at', ascending: false },
  created: { label: 'Newest first', column: 'created_at', ascending: false },
  title: { label: 'Title A–Z', column: 'title', ascending: true },
  price_high: { label: 'Price, high to low', column: 'price_php', ascending: false },
  price_low: { label: 'Price, low to high', column: 'price_php', ascending: true },
} as const satisfies Record<string, { label: string; column: string; ascending: boolean }>

export type AdminSortKey = keyof typeof ADMIN_SORTS

export const ADMIN_SORT_KEYS = Object.keys(ADMIN_SORTS) as AdminSortKey[]

/** A sort key from the query string is only ever used to look up an entry in the map above. */
function sortKeyOf(value: string | undefined): AdminSortKey {
  return value && value in ADMIN_SORTS ? (value as AdminSortKey) : 'updated'
}

function statusOf(value: string | undefined): ListingStatus | null {
  return value && STATUS_ORDER.includes(value as ListingStatus) ? (value as ListingStatus) : null
}

export type AdminListingFilters = {
  status?: string
  q?: string
  sort?: string
  page?: number
}

export type AdminListingRow = {
  id: string
  slug: string
  title: string
  status: ListingStatus
  statusLabel: string
  categoryLabel: string
  priceLabel: string
  location: string
  photoCount: number
  primaryCount: number
  updatedAtLabel: string | null
}

export type AdminListingsPage = {
  rows: AdminListingRow[]
  total: number
  page: number
  pageCount: number
}

const INDEX_COLUMNS = `
  id, slug, title, status, category, price_php, updated_at,
  towns ( name, province ),
  listing_photos ( id, is_primary )
`

type RawIndexRow = {
  id: string
  slug: string
  title: string
  status: ListingStatus
  category: DbCategory
  price_php: number
  updated_at: string
  towns: { name: string; province: string } | null
  listing_photos: { id: string; is_primary: boolean }[]
}

/**
 * The listing index, every status included — this is the only screen in the product
 * that can see a draft, so it is also the screen that has to be sure who is asking.
 */
export async function getAdminListings(filters: AdminListingFilters): Promise<AdminListingsPage> {
  await requireStaff()
  const supabase = await createClient()

  const page = Math.max(1, filters.page ?? 1)
  const sort = ADMIN_SORTS[sortKeyOf(filters.sort)]
  const status = statusOf(filters.status)

  let query = supabase.from('listings').select(INDEX_COLUMNS, { count: 'exact' })

  if (status) query = query.eq('status', status)

  const term = filters.q?.trim()
  if (term) {
    // Same escaping as the public read: `%`, `,`, `(` and `)` are all structural in a
    // PostgREST `or=` filter, so a clerk pasting "Lot 4 (Phase 2)" must not be able to
    // change what the filter means.
    const escaped = term.replace(/[%,()]/g, ' ')
    query = query.or(`title.ilike.%${escaped}%,slug.ilike.%${escaped}%,area_detail.ilike.%${escaped}%`)
  }

  const ordered = query
    .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
    .order('created_at', { ascending: false })

  const from = (page - 1) * ADMIN_PAGE_SIZE
  const requested = await ordered.range(from, from + ADMIN_PAGE_SIZE - 1)

  if (requested.error?.code === RANGE_NOT_SATISFIABLE) {
    // A hand-typed `?page=` past the end. Ask for the first page just to learn the real
    // total, then hand back an empty page so the screen can offer a way back.
    const firstPage = await ordered.range(0, ADMIN_PAGE_SIZE - 1)
    if (firstPage.error) throw firstPage.error
    const total = firstPage.count ?? 0
    return { rows: [], total, page, pageCount: Math.ceil(total / ADMIN_PAGE_SIZE) }
  }

  if (requested.error) throw requested.error

  const rows = ((requested.data ?? []) as unknown as RawIndexRow[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    categoryLabel: labelFromDb(row.category),
    priceLabel: peso(Number(row.price_php)),
    location: row.towns ? `${row.towns.name}, ${row.towns.province}` : '—',
    photoCount: row.listing_photos.length,
    primaryCount: row.listing_photos.filter((photo) => photo.is_primary).length,
    updatedAtLabel: stampLabel(row.updated_at),
  }))

  const total = requested.count ?? 0
  return { rows, total, page, pageCount: Math.ceil(total / ADMIN_PAGE_SIZE) }
}

export type AdminPhoto = {
  id: string
  storagePath: string
  altText: string | null
  sortOrder: number
  isPrimary: boolean
  /** Null when the object could not be found in either bucket — the row still shows. */
  url: string | null
}

export type AdminEvent = {
  id: string
  kind: VerificationKind
  kindLabel: string
  notes: string | null
  occurredAtLabel: string | null
  /** The name recorded against the event, or a plain marker when the actor row is gone. */
  actorName: string
}

export type AdminTransition = {
  to: ListingStatus
  label: string
  hint: string
  /** Non-empty only for the publish step; the button stays visible and disabled. */
  blockedBy: string[]
}

export type AdminListingDetail = {
  id: string
  slug: string
  title: string
  status: ListingStatus
  statusLabel: string
  category: DbCategory
  categoryLabel: string
  pricePhp: number
  priceLabel: string
  townId: string
  townLabel: string
  areaDetail: string | null
  lotAreaSqm: number | null
  floorAreaSqm: number | null
  bedrooms: number | null
  bathrooms: number | null
  description: string | null
  isTrending: boolean
  createdAtLabel: string | null
  updatedAtLabel: string | null
  publishedAtLabel: string | null
  soldAtLabel: string | null
  featureIds: string[]
  photos: AdminPhoto[]
  events: AdminEvent[]
  /** Where new uploads for this listing must go, derived from status. */
  uploadBucket: PhotoBucket
  slugEditable: boolean
  allowedTransitions: AdminTransition[]
  publishBlockers: string[]
}

const DETAIL_COLUMNS = `
  id, slug, title, status, category, price_php, town_id, area_detail,
  lot_area_sqm, floor_area_sqm, bedrooms, bathrooms, description, is_trending,
  created_at, updated_at, published_at, sold_at,
  towns ( name, province ),
  listing_features ( feature_id ),
  listing_photos ( id, storage_path, alt_text, sort_order, is_primary, created_at )
`

type RawDetailRow = {
  id: string
  slug: string
  title: string
  status: ListingStatus
  category: DbCategory
  price_php: number
  town_id: string
  area_detail: string | null
  lot_area_sqm: number | null
  floor_area_sqm: number | null
  bedrooms: number | null
  bathrooms: number | null
  description: string | null
  is_trending: boolean
  created_at: string
  updated_at: string
  published_at: string | null
  sold_at: string | null
  towns: { name: string; province: string } | null
  listing_features: { feature_id: string }[]
  listing_photos: {
    id: string
    storage_path: string
    alt_text: string | null
    sort_order: number
    is_primary: boolean
    created_at: string
  }[]
}

type RawEventRow = {
  id: string
  kind: VerificationKind
  notes: string | null
  occurred_at: string
  performed_by: string | null
  profiles: { id: string; full_name: string | null } | null
}

/**
 * One listing with everything its edit page needs, plus the four things the page must
 * not work out for itself: which bucket uploads belong in, whether the slug may still
 * change, which lifecycle moves exist from here, and what is blocking a publish.
 *
 * Those four are computed server-side because the client is not allowed to be the
 * authority on any of them — the same values are recomputed inside the actions before
 * anything is written.
 */
export async function getAdminListingDetail(id: string): Promise<AdminListingDetail | null> {
  await requireStaff()
  // A malformed id is a 404, not a 500: Postgres would reject `uuid = 'abc'` outright.
  if (!UUID.test(id)) return null

  const supabase = await createClient()

  const [listingResult, eventsResult] = await Promise.all([
    supabase.from('listings').select(DETAIL_COLUMNS).eq('id', id).maybeSingle(),
    supabase
      .from('verification_events')
      .select('id, kind, notes, occurred_at, performed_by, profiles ( id, full_name )')
      .eq('listing_id', id)
      .order('occurred_at', { ascending: false }),
  ])

  if (listingResult.error) throw listingResult.error
  if (!listingResult.data) return null
  if (eventsResult.error) throw eventsResult.error

  const row = listingResult.data as unknown as RawDetailRow
  const uploadBucket = bucketForStatus(row.status)

  const sorted = [...row.listing_photos].sort(
    (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)
  )
  const urls = await displayUrls(
    supabase,
    sorted.map((photo) => photo.storage_path),
    uploadBucket
  )

  const photos: AdminPhoto[] = sorted.map((photo) => ({
    id: photo.id,
    storagePath: photo.storage_path,
    altText: photo.alt_text,
    sortOrder: photo.sort_order,
    isPrimary: photo.is_primary,
    url: urls[photo.storage_path] ?? null,
  }))

  const rawEvents = (eventsResult.data ?? []) as unknown as RawEventRow[]
  const events: AdminEvent[] = rawEvents.map((event) => ({
    id: event.id,
    kind: event.kind,
    kindLabel: KIND_LABELS[event.kind],
    notes: event.notes,
    occurredAtLabel: stampLabel(event.occurred_at),
    actorName: event.profiles?.full_name ?? (event.performed_by ? 'Staff account' : 'Not recorded'),
  }))

  const publishBlockers = publishBlockersFor({
    titleChecks: rawEvents.filter((event) => event.kind === 'title_check').length,
    groundValidations: rawEvents.filter((event) => event.kind === 'ground_validation').length,
    photoCount: photos.length,
    primaryCount: photos.filter((photo) => photo.isPrimary).length,
  })

  const allowedTransitions: AdminTransition[] = TRANSITIONS[row.status].map((to) => ({
    to,
    label: transitionLabel(row.status, to),
    hint: transitionHint(row.status, to),
    blockedBy: to === 'live' ? publishBlockers : [],
  }))

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    category: row.category,
    categoryLabel: labelFromDb(row.category),
    pricePhp: Number(row.price_php),
    priceLabel: peso(Number(row.price_php)),
    townId: row.town_id,
    townLabel: row.towns ? `${row.towns.name}, ${row.towns.province}` : '—',
    areaDetail: row.area_detail,
    lotAreaSqm: row.lot_area_sqm === null ? null : Number(row.lot_area_sqm),
    floorAreaSqm: row.floor_area_sqm === null ? null : Number(row.floor_area_sqm),
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    description: row.description,
    isTrending: row.is_trending,
    createdAtLabel: stampLabel(row.created_at),
    updatedAtLabel: stampLabel(row.updated_at),
    publishedAtLabel: stampLabel(row.published_at),
    soldAtLabel: stampLabel(row.sold_at),
    featureIds: row.listing_features.map((link) => link.feature_id),
    photos,
    events,
    uploadBucket,
    // Once a listing has been public, its address is in search results and other
    // people's messages. Renaming it then would break every link that points at it.
    slugEditable: row.status === 'draft' || row.status === 'verifying',
    allowedTransitions,
    publishBlockers,
  }
}

export type TownOption = { id: string; label: string }

/** Towns are select-only this run: staff pick from the eight seeded rows, nothing more. */
export async function getTownOptions(): Promise<TownOption[]> {
  await requireStaff()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('towns')
    .select('id, name, province')
    .order('name')
    .order('province')

  if (error) throw error
  return (data ?? []).map((town) => ({ id: town.id, label: `${town.name}, ${town.province}` }))
}

export type FeatureOption = { id: string; name: string }

export async function getFeatureOptions(): Promise<FeatureOption[]> {
  await requireStaff()
  const supabase = await createClient()

  const { data, error } = await supabase.from('features').select('id, name').order('name')

  if (error) throw error
  return data ?? []
}
