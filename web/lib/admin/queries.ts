import { createClient } from '@/lib/supabase/server'
import { requireStaff, requireSuperAdmin } from '@/lib/admin/auth'
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
}

export type AdminListingsPage = {
  rows: AdminListingRow[]
  total: number
  page: number
  pageCount: number
}

/**
 * `property_no` is selected here and in `DETAIL_COLUMNS` and NOWHERE ELSE. It is
 * admin-only this round by the deliberate scope call recorded in §2 of
 * `20260802131500_property_number_and_role_audit.sql` — no public or anon query names it.
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

  const rows = ((requested.data ?? []) as unknown as RawIndexRow[]).map((row) => ({
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
  events: AdminEvent[]
  /** Where new uploads for this listing must go, derived from status. */
  uploadBucket: PhotoBucket
  slugEditable: boolean
  allowedTransitions: AdminTransition[]
  publishBlockers: string[]
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
// The role-change audit trail
// ---------------------------------------------------------------------------

type UserRole = Database['public']['Enums']['user_role']
type RoleChangeVia = 'invite_redeemed' | 'revoked_by_super_admin'

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
    // The check constraint allows exactly the two values above. The fallback is there so
    // a third one added later reads as a change rather than as a blank.
    viaLabel: VIA_LABELS[row.via as RoleChangeVia] ?? 'Access changed',
    granted: row.to_role === 'staff' || row.to_role === 'admin',
  }))
}
