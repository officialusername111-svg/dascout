import { createClient } from '@/lib/supabase/server'
import { CATEGORIES, dbCategoriesFor, keyFromDb, labelFromDb, type CategoryKey, type DbCategory } from '@/lib/categories'
import { area, peso, shortPeso } from '@/lib/format'

const BUCKET = 'listing-photos'

/** Public URL for a photo in the listings bucket. The bucket is public by design. */
export function photoUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!
  return `${base}/storage/v1/object/public/${BUCKET}/${storagePath}`
}

export type Spec = { icon: string | null; text: string }

export type ListingCard = {
  id: string
  slug: string
  title: string
  categoryKey: CategoryKey
  categoryLabel: string
  location: string
  town: string
  province: string
  price: number
  priceLabel: string
  shortPrice: string
  specs: Spec[]
  photo: string | null
  photoAlt: string
  trending: boolean
}

export type ListingDetail = ListingCard & {
  description: string | null
  features: string[]
  photos: { url: string; alt: string }[]
}

export type TownRow = {
  id: string
  name: string
  province: string
  slug: string
  initial: string
}

/**
 * What the listing pages read. Anything else is a column the public should not see.
 *
 * Exported so the account's favourites read can embed it under `favorites` and map the
 * result with the same `toCard` below. A second column list and a second mapper is how a
 * card ends up rendering differently on two pages for no reason anyone can find later.
 */
export const CARD_COLUMNS = `
  id, slug, title, category, price_php, area_detail, lot_area_sqm, floor_area_sqm,
  bedrooms, bathrooms, is_trending, published_at,
  towns!inner ( id, name, province, slug, initial ),
  listing_photos ( storage_path, alt_text, sort_order, is_primary ),
  listing_features ( features ( name ) )
`

export type RawListing = {
  id: string
  slug: string
  title: string
  category: DbCategory
  price_php: number
  area_detail: string | null
  lot_area_sqm: number | null
  floor_area_sqm: number | null
  bedrooms: number | null
  bathrooms: number | null
  is_trending: boolean
  published_at: string | null
  towns: { id: string; name: string; province: string; slug: string; initial: string | null } | null
  listing_photos: { storage_path: string; alt_text: string | null; sort_order: number; is_primary: boolean }[]
  listing_features?: { features: { name: string } | null }[]
}

/**
 * Feature names attached to a listing row. "Titled" leads, because a clean title is
 * the thing buyers look for first; the rest follow alphabetically so the order is stable.
 */
function featuresOf(row: RawListing): string[] {
  return (row.listing_features ?? [])
    .map((lf) => lf.features?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => {
      if (a === 'Titled') return -1
      if (b === 'Titled') return 1
      return a.localeCompare(b)
    })
}

/** Photos in the order staff arranged them, primary first. */
function sortedPhotos(row: RawListing) {
  return [...(row.listing_photos ?? [])]
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)
    .map((p) => ({ url: photoUrl(p.storage_path), alt: p.alt_text ?? row.title }))
}

/**
 * The three chips under a card. Buildings lead with rooms, land leads with area,
 * and whatever is left is filled from the listing's own features so a farm reads
 * "2 ha · Titled · Irrigated" the way the approved mockup did.
 */
function buildSpecs(row: RawListing, features: string[]): Spec[] {
  const specs: Spec[] = []
  if (row.bedrooms) specs.push({ icon: 'bed', text: `${row.bedrooms} bed` })
  if (row.bathrooms) specs.push({ icon: 'bath', text: `${row.bathrooms} bath` })
  const size = row.floor_area_sqm ?? row.lot_area_sqm
  if (size) specs.push({ icon: 'area', text: area(Number(size)) })
  for (const feature of features) {
    if (specs.length >= 3) break
    specs.push({ icon: null, text: feature })
  }
  return specs.slice(0, 3)
}

/** "Lagao, General Santos City" when there is an area detail, else "Tupi, South Cotabato". */
function locationOf(row: RawListing): string {
  const town = row.towns?.name ?? ''
  const province = row.towns?.province ?? ''
  return row.area_detail ? `${row.area_detail}, ${town}` : `${town}, ${province}`
}

export function toCard(row: RawListing, features?: string[]): ListingCard {
  const photos = sortedPhotos(row)
  const featureNames = features ?? featuresOf(row)
  const price = Number(row.price_php)
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    categoryKey: keyFromDb(row.category),
    categoryLabel: labelFromDb(row.category),
    location: locationOf(row),
    town: row.towns?.name ?? '',
    province: row.towns?.province ?? '',
    price,
    priceLabel: peso(price),
    shortPrice: shortPeso(price),
    specs: buildSpecs(row, featureNames),
    photo: photos[0]?.url ?? null,
    photoAlt: photos[0]?.alt ?? row.title,
    trending: row.is_trending,
  }
}

export type ListingFilters = {
  cat?: string
  loc?: string
  price?: string
  size?: string
  feat?: string
  az?: string
  page?: number
  trending?: boolean
  shuffle?: boolean
}

export const PAGE_SIZE = 12

/** PostgREST's code for "you asked for rows past the end of the table". */
const RANGE_NOT_SATISFIABLE = 'PGRST103'

/** Splits "2000000-5000000" / "40000000-" into numbers, ignoring anything malformed. */
function parseRange(value: string | undefined): { lo?: number; hi?: number } {
  if (!value) return {}
  const [rawLo, rawHi] = value.split('-')
  const lo = Number(rawLo)
  const hi = Number(rawHi)
  return {
    lo: rawLo !== '' && Number.isFinite(lo) ? lo : undefined,
    hi: rawHi !== '' && rawHi !== undefined && Number.isFinite(hi) ? hi : undefined,
  }
}

/**
 * One query per page load, filtered in Postgres. Row-level security already limits
 * this to `live` listings, so a forgotten filter here cannot leak a draft.
 */
export async function getListings(filters: ListingFilters): Promise<{ listings: ListingCard[]; total: number }> {
  const supabase = await createClient()
  const page = Math.max(1, filters.page ?? 1)

  let query = supabase
    .from('listings')
    .select(
      filters.feat
        ? `${CARD_COLUMNS}, matched:listing_features!inner ( features!inner ( name ) )`
        : CARD_COLUMNS,
      { count: 'exact' }
    )
    .eq('status', 'live')

  const categories = dbCategoriesFor(filters.cat)
  if (categories) query = query.in('category', categories)

  if (filters.trending) query = query.eq('is_trending', true)

  if (filters.feat) query = query.eq('matched.features.name', filters.feat)

  if (filters.az) query = query.eq('towns.initial', filters.az.toUpperCase())

  if (filters.loc) {
    // The visitor types a town, a province or a barangay; match any of them.
    const term = filters.loc.trim()
    const escaped = term.replace(/[%,()]/g, ' ')
    const { data: towns } = await supabase
      .from('towns')
      .select('id')
      .or(`name.ilike.%${escaped}%,province.ilike.%${escaped}%`)
    const townIds = (towns ?? []).map((t) => t.id)
    query = townIds.length
      ? query.or(`town_id.in.(${townIds.join(',')}),area_detail.ilike.%${escaped}%`)
      : query.ilike('area_detail', `%${escaped}%`)
  }

  const price = parseRange(filters.price)
  if (price.lo !== undefined) query = query.gte('price_php', price.lo)
  if (price.hi !== undefined) query = query.lte('price_php', price.hi)

  const size = parseRange(filters.size)
  if (size.lo !== undefined || size.hi !== undefined) {
    // A listing measures either its lot or its floor; match on whichever it carries.
    const lot = ['lot_area_sqm.not.is.null']
    const floor = ['floor_area_sqm.not.is.null']
    if (size.lo !== undefined) {
      lot.push(`lot_area_sqm.gte.${size.lo}`)
      floor.push(`floor_area_sqm.gte.${size.lo}`)
    }
    if (size.hi !== undefined) {
      lot.push(`lot_area_sqm.lte.${size.hi}`)
      floor.push(`floor_area_sqm.lte.${size.hi}`)
    }
    query = query.or(`and(${lot.join(',')}),and(${floor.join(',')})`)
  }

  const ordered = query
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  const from = (page - 1) * PAGE_SIZE
  let { data, count, error } = await ordered.range(from, from + PAGE_SIZE - 1)

  if (error?.code === RANGE_NOT_SATISFIABLE) {
    // A stale link or a hand-typed ?page= past the end. Ask for the first page instead,
    // so the caller still learns how many pages there really are.
    ;({ data, count, error } = await ordered.range(0, PAGE_SIZE - 1))
    if (!error) return { listings: [], total: count ?? 0 }
  }

  if (error) throw error

  const listings = (data as unknown as RawListing[]).map((row) => toCard(row))
  // The "Random" tab reshuffles the page it fetched, as the mockup's tab did.
  if (filters.shuffle) {
    for (let i = listings.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[listings[i], listings[j]] = [listings[j], listings[i]]
    }
  }

  return { listings, total: count ?? 0 }
}

export async function getListingBySlug(slug: string): Promise<ListingDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('listings')
    .select(`${CARD_COLUMNS}, description`)
    .eq('status', 'live')
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as unknown as RawListing & { description: string | null }
  const features = featuresOf(row)

  return {
    ...toCard(row, features),
    description: row.description,
    features,
    photos: sortedPhotos(row),
  }
}

export async function getSimilarListings(
  category: CategoryKey,
  excludeId: string,
  limit = 3
): Promise<ListingCard[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('listings')
    .select(CARD_COLUMNS)
    .eq('status', 'live')
    .eq('category', CATEGORIES[category].db)
    .neq('id', excludeId)
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data as unknown as RawListing[]).map((row) => toCard(row))
}

export async function getTowns(): Promise<TownRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('towns')
    .select('id, name, province, slug, initial')
    .order('name')

  if (error) throw error
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    province: t.province,
    slug: t.slug,
    initial: (t.initial ?? t.name[0]).toUpperCase(),
  }))
}

/**
 * The feature chips in the drawer — only features live listings actually carry, most
 * common first, so tapping one never lands on an empty result.
 */
export async function getPopularFeatures(limit = 11): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('listing_features')
    .select('features!inner ( name ), listings!inner ( status )')
    .eq('listings.status', 'live')

  if (error) throw error

  const counts = new Map<string, number>()
  for (const row of (data ?? []) as unknown as { features: { name: string } | null }[]) {
    const name = row.features?.name
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name)
}

/** How many live listings sit in each category — the count under each type tile. */
export async function getCategoryCounts(): Promise<Record<CategoryKey, number>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('listings').select('category').eq('status', 'live')
  if (error) throw error

  const counts = { rlot: 0, farm: 0, clot: 0, rbdg: 0, cbdg: 0 } as Record<CategoryKey, number>
  for (const row of data ?? []) counts[keyFromDb(row.category)] += 1
  return counts
}

/** The rotating hero card: trending first, topped up with the newest listings. */
export async function getSpotlightListings(limit = 3): Promise<ListingCard[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('listings')
    .select(CARD_COLUMNS)
    .eq('status', 'live')
    .order('is_trending', { ascending: false })
    .order('price_php', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data as unknown as RawListing[]).map((row) => toCard(row))
}

export type TopListing = ListingCard & { views: number }
export type TopPeriod = 'day' | 'week' | 'month'

/**
 * Ranked by real view events. `top_listings` counts rows in `listing_views`, which the
 * property page writes on each visit — so early on the ranking is thin and we top it up
 * with trending listings rather than showing a half-empty panel.
 */
export async function getTopListings(period: TopPeriod, limit = 6): Promise<TopListing[]> {
  const supabase = await createClient()
  const { data: ranked, error } = await supabase.rpc('top_listings', {
    period,
    row_limit: limit,
  })
  if (error) throw error

  const views = new Map((ranked ?? []).map((r) => [r.listing_id, Number(r.views)]))
  const { data, error: listingsError } = await supabase
    .from('listings')
    .select(CARD_COLUMNS)
    .eq('status', 'live')
    .order('is_trending', { ascending: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (listingsError) throw listingsError

  return (data as unknown as RawListing[])
    .map((row) => ({ ...toCard(row), views: views.get(row.id) ?? 0 }))
    .sort((a, b) => b.views - a.views || Number(b.trending) - Number(a.trending))
    .slice(0, limit)
}

export type PriceDrop = ListingCard & { previousPrice: number; dropPercent: number }
export type SoldListing = ListingCard & { soldAt: string | null }

export type MarketMovements = {
  fresh: ListingCard[]
  reduced: PriceDrop[]
  sold: SoldListing[]
}

/**
 * Three real feeds. `price_history` and sold listings are empty until staff start
 * editing prices and closing sales in Phase 4/5, so those panels show an empty state
 * instead of the mockup's invented rows.
 */
export async function getMarketMovements(limit = 5): Promise<MarketMovements> {
  const supabase = await createClient()

  const [freshResult, soldResult, historyResult] = await Promise.all([
    supabase
      .from('listings')
      .select(CARD_COLUMNS)
      .eq('status', 'live')
      .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('listings')
      .select(`${CARD_COLUMNS}, sold_at`)
      .eq('status', 'sold')
      .order('sold_at', { ascending: false, nullsFirst: false })
      .limit(limit),
    supabase
      .from('price_history')
      .select('listing_id, old_price, new_price, changed_at')
      .order('changed_at', { ascending: false })
      .limit(limit * 4),
  ])

  if (freshResult.error) throw freshResult.error
  if (soldResult.error) throw soldResult.error
  if (historyResult.error) throw historyResult.error

  const fresh = (freshResult.data as unknown as RawListing[]).map((row) => toCard(row))
  const sold = (soldResult.data as unknown as (RawListing & { sold_at: string | null })[]).map(
    (row) => ({ ...toCard(row), soldAt: row.sold_at })
  )

  // One row per listing: the most recent drop, which is what "price reduced" means.
  const drops = new Map<string, { previousPrice: number; newPrice: number }>()
  for (const change of historyResult.data ?? []) {
    const previous = Number(change.old_price ?? 0)
    const next = Number(change.new_price)
    if (!previous || next >= previous) continue
    if (!drops.has(change.listing_id)) drops.set(change.listing_id, { previousPrice: previous, newPrice: next })
  }

  let reduced: PriceDrop[] = []
  if (drops.size) {
    const { data, error } = await supabase
      .from('listings')
      .select(CARD_COLUMNS)
      .eq('status', 'live')
      .in('id', [...drops.keys()])
    if (error) throw error
    reduced = (data as unknown as RawListing[])
      .map((row) => {
        const drop = drops.get(row.id)!
        return {
          ...toCard(row),
          previousPrice: drop.previousPrice,
          dropPercent: Math.round(((drop.previousPrice - drop.newPrice) / drop.previousPrice) * 100),
        }
      })
      .slice(0, limit)
  }

  return { fresh, reduced, sold }
}

/**
 * Every live listing, for the two panels the browser owns: saved favourites and
 * "continue browsing". Both live in `localStorage` until Phase 3 moves them to the
 * account, so the browser has to match slugs against the full set itself.
 */
export async function getAllCards(limit = 60): Promise<ListingCard[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('listings')
    .select(CARD_COLUMNS)
    .eq('status', 'live')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data as unknown as RawListing[]).map((row) => toCard(row))
}
