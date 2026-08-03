import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getListings, getPopularFeatures } from '@/lib/queries'

/**
 * The public `?feat=` path, matched by SLUG rather than by NAME.
 *
 * WHY THIS SHIPS WITH THE SETTINGS SCREEN AND NOT LATER. Until piece 2 nothing in the
 * product could rename a feature, so comparing `?feat=` against `features.name` happened to
 * work — the name was as stable as a key because there was no way to change it. The
 * settings screen makes a rename a two-click job. On name matching, the first rename would
 * have silently emptied every saved link, every bookmark and every indexed search result
 * pointing at the old name: no error, no redirect, just "no properties found".
 *
 * The two halves have to agree, which is why they are tested together here: the sidebar
 * builds the link from `slug`, and the query filters on `slug`. A test that only checked
 * one of them would pass with the pair broken.
 *
 * Nothing here touches a database. The client is a recorder; what is asserted is the query
 * that WOULD have been sent — the embed, the filter column and the filter value.
 */

type Recorded = {
  table: string
  columns?: string
  filters: [string, unknown][]
}

const mocked = vi.hoisted(() => ({
  recorded: [] as Recorded[],
  /** Rows the awaited (non-`range`) reads answer with, keyed by table. */
  rows: {} as Record<string, unknown[]>,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const record: Recorded = { table, filters: [] }
      mocked.recorded.push(record)

      const chain = {
        select(columns?: string) {
          record.columns = columns
          return chain
        },
        eq(column: string, value: unknown) {
          record.filters.push([column, value])
          return chain
        },
        in(column: string, value: unknown) {
          record.filters.push([column, value])
          return chain
        },
        or(expression: string) {
          record.filters.push(['or', expression])
          return chain
        },
        ilike(column: string, value: unknown) {
          record.filters.push([column, value])
          return chain
        },
        order: () => chain,
        limit: () => chain,
        range: async () => ({ data: mocked.rows[table] ?? [], count: 0, error: null }),
        then<T>(
          onFulfilled?: ((value: unknown) => T) | null,
          onRejected?: ((reason: unknown) => T) | null
        ) {
          return Promise.resolve({ data: mocked.rows[table] ?? [], error: null }).then(
            onFulfilled,
            onRejected
          )
        },
      }

      return chain
    },
  }),
}))

/** One row as `listing_features` embeds it for the popular-features read. */
function link(name: string, slug: string) {
  return { features: { name, slug }, listings: { status: 'live' } }
}

const listingsRead = () => mocked.recorded.find((record) => record.table === 'listings')!

beforeEach(() => {
  mocked.recorded.length = 0
  mocked.rows = {}
})

describe('getListings — the feature filter matches on the key', () => {
  it('embeds features by slug and filters on the slug column', async () => {
    await getListings({ feat: 'all-documents-verified' })

    const read = listingsRead()
    expect(read.columns).toContain('matched:listing_features!inner ( features!inner ( slug ) )')
    expect(read.filters).toContainEqual([
      'matched.features.slug',
      'all-documents-verified',
    ])
  })

  /**
   * The regression guard. If either the embed or the filter drifts back to `name`, saved
   * `?feat=` links start matching the display text again and a rename breaks them.
   */
  it('mentions no feature NAME anywhere in the query it sends', async () => {
    await getListings({ feat: 'titled' })

    const read = listingsRead()
    expect(read.columns).not.toContain('features!inner ( name )')
    expect(read.filters.map(([column]) => column)).not.toContain('matched.features.name')
  })

  it('adds neither the embed nor the filter when no feature was asked for', async () => {
    await getListings({})

    const read = listingsRead()
    expect(read.columns).not.toContain('matched:listing_features')
    expect(read.filters.map(([column]) => column)).not.toContain('matched.features.slug')
  })

  it('passes the key through exactly as given — no case folding, no trimming, no lookup', async () => {
    await getListings({ feat: 'updated-tax-declaration' })

    expect(listingsRead().filters).toContainEqual([
      'matched.features.slug',
      'updated-tax-declaration',
    ])
  })

  it('still filters on status, so a filtered search cannot reach an unpublished listing', async () => {
    await getListings({ feat: 'titled' })
    expect(listingsRead().filters).toContainEqual(['status', 'live'])
  })
})

describe('getPopularFeatures — the chips carry both halves', () => {
  it('selects the name AND the key, because the chip shows one and links with the other', async () => {
    mocked.rows.listing_features = [link('Titled', 'titled')]

    const features = await getPopularFeatures()

    const read = mocked.recorded.find((record) => record.table === 'listing_features')!
    expect(read.columns).toContain('features!inner ( name, slug )')
    expect(features).toEqual([{ name: 'Titled', slug: 'titled' }])
  })

  it('orders by how many live listings carry each one, then by name', async () => {
    mocked.rows.listing_features = [
      link('Fenced', 'fenced'),
      link('Titled', 'titled'),
      link('Titled', 'titled'),
      link('Direct Owner', 'direct-owner'),
      link('Direct Owner', 'direct-owner'),
    ]

    const features = await getPopularFeatures()

    expect(features.map((feature) => feature.slug)).toEqual([
      'direct-owner',
      'titled',
      'fenced',
    ])
  })

  it('honours the limit', async () => {
    mocked.rows.listing_features = [
      link('A', 'a'),
      link('B', 'b'),
      link('C', 'c'),
    ]

    expect(await getPopularFeatures(2)).toHaveLength(2)
  })

  it('drops a row whose feature could not be read rather than rendering a blank chip', async () => {
    mocked.rows.listing_features = [
      { features: null, listings: { status: 'live' } },
      link('Titled', 'titled'),
    ]

    expect(await getPopularFeatures()).toEqual([{ name: 'Titled', slug: 'titled' }])
  })

  /**
   * Tallied by key, not by name. Two features that momentarily share a name — mid-rename,
   * or by an owner's mistake — are two different chips pointing at two different sets of
   * listings, and merging them would send half the traffic to the wrong filter.
   */
  it('keeps two features with the same name apart, because their keys differ', async () => {
    mocked.rows.listing_features = [
      link('Titled', 'titled'),
      link('Titled', 'titled-clean'),
    ]

    const features = await getPopularFeatures()
    expect(features.map((feature) => feature.slug).sort()).toEqual(['titled', 'titled-clean'])
  })
})

describe('a rename does not break a saved link — the two halves agree', () => {
  /**
   * The end-to-end property, walked in the order a person hits it:
   *
   *   1. the sidebar reads the chips and links with `feature.slug`;
   *   2. somebody renames that feature on /admin/settings — the name changes, the key
   *      cannot (there is no slug field on the update schema at all);
   *   3. the saved link is followed, and the query still filters on the same key.
   *
   * On the old name-based matching, step 3 filtered on a name that no longer existed and
   * returned nothing.
   */
  it('the key the chip links with is the key the query filters on, before and after a rename', async () => {
    mocked.rows.listing_features = [link('All documents Verified', 'all-documents-verified')]
    const before = await getPopularFeatures()
    const linkedKey = before[0].slug

    mocked.recorded.length = 0
    await getListings({ feat: linkedKey })
    expect(listingsRead().filters).toContainEqual([
      'matched.features.slug',
      'all-documents-verified',
    ])

    // The rename. Same row, same key, different words on the screen.
    mocked.recorded.length = 0
    mocked.rows.listing_features = [link('All papers verified', 'all-documents-verified')]
    const after = await getPopularFeatures()

    expect(after[0].name).toBe('All papers verified')
    expect(after[0].slug).toBe(linkedKey)

    mocked.recorded.length = 0
    await getListings({ feat: linkedKey })
    expect(listingsRead().filters).toContainEqual([
      'matched.features.slug',
      'all-documents-verified',
    ])
  })
})
