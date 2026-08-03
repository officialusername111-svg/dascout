import { createClient } from '@/lib/supabase/server'
import { requireStaff, requireSuperAdmin } from '@/lib/admin/auth'
import {
  CANDIDATE_STATE_LABELS,
  candidateDisplayName,
  candidateMetaLine,
  candidateState,
  type CandidateState,
} from '@/lib/admin/invites'
import { bucketForStatus, displayUrls, type PhotoBucket } from '@/lib/admin/photos'
import { labelFromDb, type DbCategory } from '@/lib/categories'
import { describeBudget } from '@/lib/budget'
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

export const ADMIN_PAGE_SIZE = 25

/** PostgREST's code for "you asked for rows past the end of the table". */
const RANGE_NOT_SATISFIABLE = 'PGRST103'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const STATUS_LABELS: Record<ListingStatus, string> = {
  list: 'List',
  for_approval: 'For Approval',
  live: 'Live',
  sold: 'Sold',
  withdrawn: 'Withdrawn',
}

export const STATUS_ORDER: ListingStatus[] = ['list', 'for_approval', 'live', 'sold', 'withdrawn']

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
 *
 * `guard_listing_publish` enforces this same graph inside the database as of
 * 20260803110000_listing_encoding_v2_apply2.sql. The two must stay in step: a move
 * added here and not there is refused at the last moment with a database message, and
 * a move added there and not here is simply unreachable from the screen.
 */
export const TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  list: ['for_approval'],
  for_approval: ['list', 'live'],
  live: ['sold', 'withdrawn'],
  sold: [],
  withdrawn: ['live'],
}

export function transitionLabel(from: ListingStatus, to: ListingStatus): string {
  if (from === 'list' && to === 'for_approval') return 'Submit for approval'
  if (from === 'for_approval' && to === 'list') return 'Send back to the list'
  if (from === 'for_approval' && to === 'live') return 'Publish'
  if (from === 'live' && to === 'sold') return 'Mark as sold'
  if (from === 'live' && to === 'withdrawn') return 'Withdraw from the site'
  if (from === 'withdrawn' && to === 'live') return 'Relist'
  return `Move to ${STATUS_LABELS[to]}`
}

export function transitionHint(from: ListingStatus, to: ListingStatus): string {
  if (from === 'list' && to === 'for_approval') return 'Hands it to whoever signs listings off.'
  if (from === 'for_approval' && to === 'list') return 'Nothing is published; the listing goes back for edits.'
  if (from === 'for_approval' && to === 'live')
    return 'Moves the photos to the public bucket and puts the listing on the site.'
  if (from === 'live' && to === 'sold') return 'Final. The listing stops appearing as available.'
  if (from === 'live' && to === 'withdrawn')
    return 'Takes it off the site. Photos already published stay reachable by their direct link.'
  if (from === 'withdrawn' && to === 'live') return 'Puts it back on the site.'
  return ''
}

export type PublishCheckInput = {
  photoCount: number
  primaryCount: number
}

/**
 * Why a listing cannot go live yet, in words the person reading them can act on.
 *
 * Photos only, since apply 2 of listing encoding v2. The two fieldwork checks that used
 * to head this list were counts of `verification_events` rows, and that table is gone —
 * approval is now the act of moving the listing from For Approval to Live, and the
 * database enforces that path in `guard_listing_publish` rather than counting evidence.
 */
export function publishBlockersFor(input: PublishCheckInput): string[] {
  const blockers: string[] = []
  if (input.photoCount < 1) blockers.push('The listing has no photos.')
  else if (input.primaryCount !== 1) blockers.push('No cover photo has been chosen.')
  return blockers
}

/** Where a checklist item sends someone who wants to fix it. */
export type CheckAnchor = 'details' | 'photos'

export type PublishCheckItem = {
  id: string
  label: string
  done: boolean
  /**
   * False means ADVISORY ONLY. A soft item is shown in the checklist and counted in the
   * "needs attention" strip, but it never appears in `publishBlockersFor`, never disables
   * the publish button, and has no counterpart in `guard_listing_publish`.
   */
  required: boolean
  anchor: CheckAnchor
  /** The same gap said in three words, for the index row where a sentence will not fit. */
  chip: string
  /** Shown under the label when the item is soft, so nobody reads it as a hard gate. */
  note?: string
}

/**
 * The publish checklist the detail screen shows, and the source of the row chips and the
 * attention strip on the index.
 *
 * This function does NOT decide what blocks a publish — `publishBlockersFor` does, and the
 * database trigger `guard_listing_publish` decides it again underneath. This one only
 * decides what is DISPLAYED, which is why it can carry an item the enforcement layer does
 * not have. Keeping the two apart is deliberate: the property number is something the
 * office wants prompted, not something that should stop a listing going live, and the two
 * ideas stop being confusable once they live in different functions.
 */
export function publishChecklistFor(
  input: PublishCheckInput & { propertyNo: string | null }
): PublishCheckItem[] {
  return [
    {
      id: 'has-photo',
      label: 'At least one photo uploaded',
      chip: 'No photos',
      done: input.photoCount >= 1,
      required: true,
      anchor: 'photos',
    },
    // "Cover photo chosen" is only a question once a photo exists. Listing it against a
    // listing with no photos gave the first build of this screen a checklist that read
    // "☐ At least one photo uploaded / ☑ Cover photo chosen", which is nonsense — and
    // counting both would have reported one missing photo set as two separate failures.
    ...(input.photoCount >= 1
      ? [
          {
            id: 'cover-photo',
            label: 'Cover photo chosen',
            chip: 'No cover photo',
            done: input.primaryCount === 1,
            required: true,
            anchor: 'photos' as CheckAnchor,
          },
        ]
      : []),
    {
      id: 'property-no',
      label: 'Property number given',
      // No trailing full stop: these chips are also joined into a sentence in the
      // attention strip, where "no property no.." read as a typo.
      chip: 'No property number',
      done: Boolean(input.propertyNo),
      required: false,
      anchor: 'details',
      note: 'Recommended, not required — this will not stop the listing going live.',
    },
  ]
}

/** The gaps only, in chip wording, for an index row where a sentence will not fit. */
export function checklistChips(items: PublishCheckItem[]): string[] {
  return items.filter((item) => !item.done).map((item) => item.chip)
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
  /**
   * Restrict to these ids. Used by the attention filter, which computes its set from the
   * whole List/For Approval population rather than from one page. An EMPTY array means
   * "restrict to nothing" and correctly returns no rows; `undefined` means no restriction.
   */
  ids?: string[]
}

export type AdminListingRow = {
  id: string
  slug: string
  /** The office's own reference. Null on every listing created before it existed. */
  propertyNo: string | null
  title: string
  status: ListingStatus
  statusLabel: string
  categoryLabel: string
  priceLabel: string
  location: string
  photoCount: number
  primaryCount: number
  updatedAtLabel: string | null
  /** Unfinished checklist items, in chip wording. Empty when the listing is complete. */
  blockers: string[]
  /** True only where an unfinished checklist still means something — List and For Approval. */
  needsAttention: boolean
}

export type AdminListingsPage = {
  rows: AdminListingRow[]
  total: number
  page: number
  pageCount: number
}

export type AdminStatusCounts = { all: number } & Record<ListingStatus, number>

/**
 * The counts beside each status tab. One round trip that reads a single enum column for
 * every row and tallies in memory, rather than six `head: true` count queries — at this
 * table's size that is one request instead of six, and the shape stays honest if the
 * table grows because the column is the narrowest one there is.
 */
export async function getAdminStatusCounts(): Promise<AdminStatusCounts> {
  await requireStaff()
  const supabase = await createClient()

  const { data, error } = await supabase.from('listings').select('status')
  if (error) throw error

  const counts = { all: 0, list: 0, for_approval: 0, live: 0, sold: 0, withdrawn: 0 }
  for (const row of (data ?? []) as { status: ListingStatus }[]) {
    counts.all += 1
    counts[row.status] += 1
  }
  return counts
}

export type AdminAttention = {
  /** Ids of listings that could still go live but have an unfinished checklist. */
  ids: string[]
  /** How many listings are missing each thing, for the one-line summary. */
  reasons: { chip: string; count: number }[]
}

/**
 * The "N listings need attention" strip on the index.
 *
 * Restricted to List and For Approval — see ATTENTION_STATUSES. The ids come back so
 * "Show only these" can filter the real list rather than re-deriving the set from a page
 * that has already been paginated, which would have quietly reported only the gaps
 * visible on page one.
 */
export async function getAdminAttention(): Promise<AdminAttention> {
  await requireStaff()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('listings')
    .select('id, property_no, listing_photos ( is_primary )')
    .in('status', ATTENTION_STATUSES)
  if (error) throw error

  const ids: string[] = []
  const tally = new Map<string, number>()

  for (const row of (data ?? []) as unknown as {
    id: string
    property_no: string | null
    listing_photos: { is_primary: boolean }[]
  }[]) {
    const gaps = checklistChips(checklistForRow(row))
    if (!gaps.length) continue
    ids.push(row.id)
    for (const gap of gaps) tally.set(gap, (tally.get(gap) ?? 0) + 1)
  }

  return {
    ids,
    reasons: [...tally.entries()]
      .map(([chip, count]) => ({ chip, count }))
      .sort((a, b) => b.count - a.count || a.chip.localeCompare(b.chip)),
  }
}

/**
 * `listing_photos ( id, is_primary )` is embedded so an index row can show the SAME
 * publish checklist the detail screen shows, rather than a different one derived from
 * whatever the list query happened to select.
 */
const INDEX_COLUMNS = `
  id, slug, property_no, title, status, category, price_php, updated_at,
  towns ( name, province ),
  listing_photos ( id, is_primary )
`

type RawIndexRow = {
  id: string
  slug: string
  property_no: string | null
  title: string
  status: ListingStatus
  category: DbCategory
  price_php: number
  updated_at: string
  towns: { name: string; province: string } | null
  listing_photos: { id: string; is_primary: boolean }[]
}

/** The checklist for one raw index row — the same function the detail screen calls. */
function checklistForRow(row: {
  property_no: string | null
  listing_photos: { is_primary: boolean }[]
}): PublishCheckItem[] {
  return publishChecklistFor({
    photoCount: row.listing_photos.length,
    primaryCount: row.listing_photos.filter((p) => p.is_primary).length,
    propertyNo: row.property_no,
  })
}

/**
 * Statuses where an unfinished checklist is still actionable. A live or sold listing is
 * already published, so reporting "no cover photo" against it is noise, not attention —
 * and scoping the attention sweep this way keeps it to the small end of the table.
 */
const ATTENTION_STATUSES: ListingStatus[] = ['list', 'for_approval']

/**
 * The listing index, every status included — this is the only screen in the product that
 * can see an unpublished listing, so it is also the screen that has to be sure who is
 * asking.
 */
export async function getAdminListings(filters: AdminListingFilters): Promise<AdminListingsPage> {
  await requireStaff()
  const supabase = await createClient()

  const page = Math.max(1, filters.page ?? 1)
  const sort = ADMIN_SORTS[sortKeyOf(filters.sort)]
  const status = statusOf(filters.status)

  let query = supabase.from('listings').select(INDEX_COLUMNS, { count: 'exact' })

  if (status) query = query.eq('status', status)
  if (filters.ids) query = query.in('id', filters.ids)

  const term = filters.q?.trim()
  if (term) {
    // Same escaping as the public read: `%`, `,`, `(` and `)` are all structural in a
    // PostgREST `or=` filter, so a clerk pasting "Lot 4 (Phase 2)" must not be able to
    // change what the filter means.
    const escaped = term.replace(/[%,()]/g, ' ')
    // `property_no` joins the same `or=` list rather than getting a mechanism of its own:
    // staff type one thing into one box, and `ilike` is already case-insensitive, so
    // "ds-0142" finds DS-0142 without any extra work.
    query = query.or(
      `title.ilike.%${escaped}%,slug.ilike.%${escaped}%,area_detail.ilike.%${escaped}%,property_no.ilike.%${escaped}%`
    )
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

  const rows = ((requested.data ?? []) as unknown as RawIndexRow[]).map((row) => {
    const blockers = checklistChips(checklistForRow(row))
    return {
      id: row.id,
      slug: row.slug,
      propertyNo: row.property_no,
      title: row.title,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status],
      categoryLabel: labelFromDb(row.category),
      priceLabel: peso(Number(row.price_php)),
      location: row.towns ? `${row.towns.name}, ${row.towns.province}` : '—',
      photoCount: row.listing_photos.length,
      primaryCount: row.listing_photos.filter((photo) => photo.is_primary).length,
      updatedAtLabel: stampLabel(row.updated_at),
      blockers,
      needsAttention: blockers.length > 0 && ATTENTION_STATUSES.includes(row.status),
    }
  })

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
  propertyNo: string | null
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
  /** Where new uploads for this listing must go, derived from status. */
  uploadBucket: PhotoBucket
  slugEditable: boolean
  allowedTransitions: AdminTransition[]
  publishBlockers: string[]
  /** Everything the publish checklist shows, done and not-done, hard and soft. */
  publishChecklist: PublishCheckItem[]
}

const DETAIL_COLUMNS = `
  id, slug, property_no, title, status, category, price_php, town_id, area_detail,
  lot_area_sqm, floor_area_sqm, bedrooms, bathrooms, description, is_trending,
  created_at, updated_at, published_at, sold_at,
  towns ( name, province ),
  listing_features ( feature_id ),
  listing_photos ( id, storage_path, alt_text, sort_order, is_primary, created_at )
`

type RawDetailRow = {
  id: string
  slug: string
  property_no: string | null
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

  const listingResult = await supabase
    .from('listings')
    .select(DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (listingResult.error) throw listingResult.error
  if (!listingResult.data) return null

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

  const checkInput = {
    photoCount: photos.length,
    primaryCount: photos.filter((photo) => photo.isPrimary).length,
  }

  // Two derivations from ONE input, kept separate on purpose: `publishBlockers` is what
  // actually stops a publish, `publishChecklist` is what the screen shows. The checklist
  // carries the soft property-number item the blockers must never gain.
  const publishBlockers = publishBlockersFor(checkInput)
  const publishChecklist = publishChecklistFor({ ...checkInput, propertyNo: row.property_no })

  const allowedTransitions: AdminTransition[] = TRANSITIONS[row.status].map((to) => ({
    to,
    label: transitionLabel(row.status, to),
    hint: transitionHint(row.status, to),
    blockedBy: to === 'live' ? publishBlockers : [],
  }))

  return {
    id: row.id,
    slug: row.slug,
    propertyNo: row.property_no,
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
    uploadBucket,
    // Once a listing has been public, its address is in search results and other
    // people's messages. Renaming it then would break every link that points at it.
    slugEditable: row.status === 'list' || row.status === 'for_approval',
    allowedTransitions,
    publishBlockers,
    publishChecklist,
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

// ---------------------------------------------------------------------------
// Property requests
// ---------------------------------------------------------------------------

export type AdminRequestRow = {
  id: string
  createdAtLabel: string | null
  categoryLabel: string
  preferredTown: string
  budgetLabel: string
  notes: string | null
  email: string
  isHandled: boolean
  alertsSent: number
}

/** One screen's worth. There is no paging here yet; add it when the list warrants it. */
export const REQUEST_PAGE_SIZE = 200

/**
 * Every saved property request, open ones first and newest first inside each group.
 *
 * The alert counts come from a second read rather than an embed because the count that
 * matters is "how many alerts have actually GONE OUT for this request" — `sent_at` is not
 * null — and PostgREST cannot express a filtered count inside an embed without a view.
 * Two small reads beat a view nobody maintains.
 *
 * Nothing here is formatted as HTML and nothing is linkified. Every field below is
 * somebody else's typing and the page renders all of it as plain text.
 */
export async function getPropertyRequests(): Promise<AdminRequestRow[]> {
  await requireStaff()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('property_requests')
    .select('id, created_at, category, preferred_town, budget_min, budget_max, notes, email, is_handled')
    .order('is_handled', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(REQUEST_PAGE_SIZE)

  if (error) throw error

  const rows = data ?? []
  const sent = new Map<string, number>()

  if (rows.length) {
    const { data: alerts, error: alertError } = await supabase
      .from('request_match_alerts')
      .select('request_id')
      .in('request_id', rows.map((row) => row.id))
      .not('sent_at', 'is', null)

    if (alertError) throw alertError
    for (const alert of alerts ?? []) {
      sent.set(alert.request_id, (sent.get(alert.request_id) ?? 0) + 1)
    }
  }

  return rows.map((row) => ({
    id: row.id,
    createdAtLabel: stampLabel(row.created_at),
    categoryLabel: row.category ? labelFromDb(row.category) : 'Any type',
    preferredTown: row.preferred_town?.trim() || 'Anywhere',
    budgetLabel: describeBudget(
      row.budget_min === null ? null : Number(row.budget_min),
      row.budget_max === null ? null : Number(row.budget_max),
      peso
    ),
    notes: row.notes,
    email: row.email,
    isHandled: row.is_handled,
    alertsSent: sent.get(row.id) ?? 0,
  }))
}

// ---------------------------------------------------------------------------
// Admin accounts
// ---------------------------------------------------------------------------

export type AdminAccountRow = {
  id: string
  email: string
  fullName: string | null
  role: 'staff' | 'admin'
  roleLabel: string
  joinedLabel: string | null
  /** True for the row belonging to whoever is looking at the screen. */
  isSelf: boolean
  /** A staff row that is not the caller's own. Nothing else may be removed. */
  canRemove: boolean
}

const ADMIN_ROLE_LABELS: Record<'staff' | 'admin', string> = {
  admin: 'Owner',
  staff: 'Admin',
}

/**
 * Every account that can open the admin panel, for the one screen that manages them.
 *
 * It goes through `list_admin_accounts()` rather than a `profiles` select because the
 * email address lives in `auth.users`, which no API caller may read — the function is
 * SECURITY DEFINER and joins the two, after checking `is_super_admin()` itself. A screen
 * that listed admins without their addresses would be useless: the address is the only
 * thing that identifies which person a row is.
 *
 * `requireSuperAdmin()` here is not belt-and-braces over the page. It is the same rule
 * every other function in this file follows — a query is the last place before rows leave
 * the database, and it is the only guard that still holds when some future route or
 * action calls this function instead.
 *
 * `canRemove` is computed here rather than in the page so the page cannot get it wrong.
 * It is a display rule, not a control: `revoke_staff_admin` refuses an `admin` target and
 * refuses the caller's own row regardless of what any form posts.
 */
export async function listAdminAccounts(): Promise<AdminAccountRow[]> {
  const me = await requireSuperAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('list_admin_accounts')
  if (error) throw error

  // Owners first, then oldest account first, so the list reads as a history rather than
  // as whatever order the planner happened to return it in.
  const ordered = [...(data ?? [])].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1
    return a.created_at.localeCompare(b.created_at)
  })

  return ordered.map((row) => {
    const role: 'staff' | 'admin' = row.role === 'admin' ? 'admin' : 'staff'
    const isSelf = row.profile_id === me.id
    return {
      id: row.profile_id,
      email: row.email,
      fullName: row.full_name ?? null,
      role,
      roleLabel: ADMIN_ROLE_LABELS[role],
      joinedLabel: stampLabel(row.created_at),
      isSelf,
      canRemove: role === 'staff' && !isSelf,
    }
  })
}

// ---------------------------------------------------------------------------
// The approval queue
// ---------------------------------------------------------------------------

export type AdminCandidateRow = {
  /** What the approve and decline forms post. An INVITATION id, never an account id. */
  inviteId: string
  email: string
  /** `ready` — a confirmed account exists. `not_signed_up` — nobody has created one. */
  state: CandidateState
  stateLabel: string
  /** The account's own name, falling back to the invited address. See the helper. */
  displayName: string
  /** The whole second line, already composed, so the page cannot compose it wrongly. */
  metaLine: string
  /** True only for a row the owner may approve. Display only — the RPC re-derives it. */
  canApprove: boolean
}

/**
 * Two outcomes, not one list. `installed: false` means the approval-queue migration has
 * not been applied to this database yet — which is a state the screen must SAY, because
 * an empty list would read as "nobody is waiting".
 */
export type AdminCandidateQueue =
  | { installed: true; rows: AdminCandidateRow[] }
  | { installed: false }

/**
 * The RPC this reads, typed narrowly through a cast.
 *
 * Same reason as `InviteDecisionRpcClient` in `app/admin/actions.ts`:
 * `lib/database.types.ts` is generated from the live schema and
 * `supabase/migrations/20260802204500_admin_invite_approval_queue.sql` is written but NOT
 * applied, so the generator has never seen this function. Until it is applied this call
 * comes back PGRST202 and the page throws — which is the honest outcome for a screen whose
 * data source does not exist yet.
 */
type CandidatesRpcClient = {
  rpc(fn: 'list_admin_candidates'): PromiseLike<{
    data:
      | {
          invite_id: string
          email: string
          /** Null when nobody has signed up, and null when the account carries no name. */
          full_name: string | null
          account_created_at: string | null
          invited_at: string
          invite_expires_at: string
          has_confirmed_account: boolean
        }[]
      | null
    error: { code: string; message: string } | null
  }>
}

/**
 * Every live invitation, in the two states the queue shows: ready to approve, and invited
 * but not signed up.
 *
 * "Ready" is DERIVED, never stored: the invitation is still pending, has not expired, and
 * its address matches an account whose email is confirmed. There is no fourth status value
 * and nothing to keep in step — see §2 of the migration. An invitation appearing here has
 * been granted NOTHING, in either state; the only thing that grants a role is the owner
 * pressing approve, which is `approveAdminInvite` and nothing else.
 *
 * The not-signed-up rows are here on purpose. They are the ones the owner most often needs
 * to CANCEL — an invitation typed to a wrong address never reaches a confirmed account —
 * and before this run they were invisible for seven days with no way to recall them.
 *
 * It goes through `list_admin_candidates()` rather than an `admin_invites` select for the
 * same reason `listAdminAccounts` goes through its own function: the confirmed-account
 * half of the predicate lives in `auth.users`, which no API caller may read. Doing it as
 * two reads — the invitations over PostgREST, the confirmed accounts from somewhere else —
 * would mean computing the state in TypeScript from a set difference, and the state would
 * be wrong the moment either read was stale. One function, one snapshot, one predicate.
 *
 * `requireSuperAdmin()` here is not belt-and-braces over the page — it is the rule every
 * function in this file follows, and it is the guard that still holds when a future route
 * or action calls this instead of the page.
 */
export async function listAdminCandidates(): Promise<AdminCandidateQueue> {
  await requireSuperAdmin()
  const supabase = await createClient()

  const { data, error } = await (supabase as unknown as CandidatesRpcClient).rpc(
    'list_admin_candidates'
  )

  /**
   * ONE error is not a fault, and it is this one.
   *
   * PGRST202 is PostgREST saying "there is no such function": the migration has not been
   * applied yet. That is a real state of this project — the migration ships in the same
   * commit as this code and is applied deliberately, by a person, afterwards — and it must
   * not take the whole Admins page down with it, because that page is also where the owner
   * invites and removes admins and where they would go to fix anything.
   *
   * It is reported as `installed: false`, NEVER as an empty list. An empty list on this
   * screen reads as "nobody is waiting", which is a different and much worse lie than "the
   * queue is not installed yet" — the same silent-failure trap the migration's header
   * warns about for `list_admin_accounts`.
   *
   * Every other error still throws. A database that is not answering is a fault.
   */
  if (error?.code === 'PGRST202') {
    console.warn('[admin] list_admin_candidates is missing — apply the approval-queue migration')
    return { installed: false }
  }

  if (error) throw error

  // Re-sorted here rather than trusted from the wire, exactly as `listAdminAccounts` does
  // it: ready rows first (they are the ones that can be acted on), then oldest invitation
  // first inside each group, so the person who has waited longest is at the top.
  const rows = [...(data ?? [])]
    .sort((a, b) => {
      if (a.has_confirmed_account !== b.has_confirmed_account) {
        return a.has_confirmed_account ? -1 : 1
      }
      return a.invited_at.localeCompare(b.invited_at)
    })
    .map((row) => {
      const state = candidateState(row.has_confirmed_account)
      return {
        inviteId: row.invite_id,
        email: row.email,
        state,
        stateLabel: CANDIDATE_STATE_LABELS[state],
        displayName: candidateDisplayName(row.full_name, row.email),
        metaLine: candidateMetaLine(state, {
          accountCreatedLabel: stampLabel(row.account_created_at),
          invitedLabel: stampLabel(row.invited_at),
          expiresLabel: stampLabel(row.invite_expires_at),
        }),
        canApprove: state === 'ready',
      }
    })

  return { installed: true, rows }
}

// ---------------------------------------------------------------------------
// The role-change audit trail
// ---------------------------------------------------------------------------

type UserRole = Database['public']['Enums']['user_role']
/**
 * The three values `admin_role_changes.via` may carry. The third arrives with
 * `20260802204500_admin_invite_approval_queue.sql`, which widens the CHECK additively.
 *
 * An approval is deliberately NOT recorded as `invite_redeemed`: that value means the
 * invitee presented their own secret and promoted themselves, and reusing it for an
 * approval would name the wrong actor and claim a consent that never happened.
 */
type RoleChangeVia = 'invite_redeemed' | 'revoked_by_super_admin' | 'approved_by_super_admin'

export type AdminRoleChangeRow = {
  id: string
  changedAtLabel: string | null
  /** A name, a short id, or a plain marker when the account itself is gone. */
  actorName: string
  targetName: string
  fromRoleLabel: string
  toRoleLabel: string
  viaLabel: string
  /** True when access was granted, false when it was taken away. Drives the pill only. */
  granted: boolean
}

/** One screen's worth of history. The table itself keeps everything; this reads the top. */
export const ROLE_CHANGE_LIMIT = 20

const ROLE_LABELS: Record<UserRole, string> = {
  buyer: 'Buyer',
  broker: 'Broker',
  staff: 'Admin',
  admin: 'Owner',
}

const VIA_LABELS: Record<RoleChangeVia, string> = {
  invite_redeemed: 'Invitation accepted',
  revoked_by_super_admin: 'Removed by the owner',
  approved_by_super_admin: 'Approved by the owner',
}

type RawRoleChangeRow = {
  id: string
  actor_id: string | null
  target_id: string
  from_role: UserRole
  to_role: UserRole
  via: string
  changed_at: string
}

/**
 * The first eight characters of a uuid, for a person whose profile has no name on it.
 *
 * Enough to tell two rows apart and to match against a row in the accounts list above; it
 * is not an identity and is not offered as one. The alternative would be the email
 * address, which lives in `auth.users` and which no API caller may read — reaching it
 * would mean another SECURITY DEFINER function, and a new privileged door is a poor trade
 * for a nicer label on an audit line.
 */
function shortId(id: string): string {
  return id.slice(0, 8)
}

/**
 * The most recent admin role changes, newest first.
 *
 * The names come from a SECOND read rather than an embed. `admin_role_changes` has two
 * foreign keys into `profiles` — the actor and the target — so an embed would need a
 * disambiguating hint and would still hand back a shape that has to be flattened. One
 * `in` on the ids involved is smaller, and it is the pattern `getPropertyRequests` above
 * already uses for the same reason.
 *
 * A missing profile is not an error. `actor_id` is `on delete set null` on purpose: the
 * record of what was done outlives the account that did it, so a null actor renders as a
 * plain marker rather than dropping the row from the trail.
 */
export async function listAdminRoleChanges(): Promise<AdminRoleChangeRow[]> {
  await requireSuperAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('admin_role_changes')
    .select('id, actor_id, target_id, from_role, to_role, via, changed_at')
    .order('changed_at', { ascending: false })
    .limit(ROLE_CHANGE_LIMIT)

  if (error) throw error

  const rows = (data ?? []) as unknown as RawRoleChangeRow[]
  if (!rows.length) return []

  const ids = [
    ...new Set(rows.flatMap((row) => (row.actor_id ? [row.actor_id, row.target_id] : [row.target_id]))),
  ]

  const { data: people, error: peopleError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', ids)

  if (peopleError) throw peopleError

  const names = new Map((people ?? []).map((person) => [person.id, person.full_name]))

  /** A name if the profile carries one, otherwise the id fragment. */
  const nameOf = (id: string): string => names.get(id)?.trim() || `Account ${shortId(id)}`

  return rows.map((row) => ({
    id: row.id,
    changedAtLabel: stampLabel(row.changed_at),
    actorName: row.actor_id ? nameOf(row.actor_id) : 'Account since removed',
    targetName: nameOf(row.target_id),
    fromRoleLabel: ROLE_LABELS[row.from_role],
    toRoleLabel: ROLE_LABELS[row.to_role],
    // The check constraint allows exactly the three values above. The fallback is there
    // so a fourth one added later reads as a change rather than as a blank.
    viaLabel: VIA_LABELS[row.via as RoleChangeVia] ?? 'Access changed',
    granted: row.to_role === 'staff' || row.to_role === 'admin',
  }))
}
