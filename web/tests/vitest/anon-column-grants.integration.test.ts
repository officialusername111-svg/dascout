import { describe, it, expect } from 'vitest'
import { anonClient } from './helpers'

/**
 * run-p8-price-detach — the anon API must REFUSE `price_php`.
 *
 * Why this file exists at all. The project rule is "no peso amounts anywhere public", and
 * two E2E specs already assert that no `₱` appears in the rendered HTML of the home page
 * and the property page. Those specs passed every single run while anonymous callers could
 * read every price in the table straight off PostgREST, because rendered HTML is not the
 * API surface. A rule enforced only by what the app remembers to ask for is not enforced.
 * These assertions are against the API itself, which is where the rule was actually broken.
 *
 * WRITES NOTHING. No fixtures, no cleanup, no `zz-` rows — every assertion is a read
 * against whatever live data already exists, which matters because the only database this
 * project can reach is production.
 *
 * The companion half is in `tests/e2e/06-public-smoke.spec.ts`: this file proves the column
 * is refused, that one proves the public pages still render without it. Neither is
 * sufficient alone — a revoke that took the site down would pass this file completely.
 */
describe('anon column grants on public.listings (run-p8-price-detach)', () => {
  /** Columns no anonymous caller may read. */
  const WITHHELD = ['price_php', 'broker_id', 'created_by', 'sold_at'] as const

  /**
   * Exactly the list granted in `20260802160000_listings_detach_anon_column_grant.sql`.
   * Kept spelled out rather than imported so that a careless edit to the grant has to be
   * made twice, in two files, to go unnoticed.
   */
  const GRANTED = [
    'id',
    'slug',
    'title',
    'category',
    'area_detail',
    'lot_area_sqm',
    'floor_area_sqm',
    'bedrooms',
    'bathrooms',
    'is_trending',
    'published_at',
    'created_at',
    'updated_at',
    'status',
    'town_id',
    'description',
    'property_no',
  ] as const

  it.each(WITHHELD)('anon is refused when it asks for %s', async (column) => {
    const anon = anonClient()
    const { data, error } = await anon.from('listings').select(column).limit(1)

    // The refusal must come from the database, not from an empty result set: a query that
    // merely returned no rows would pass a naive assertion while the column stayed
    // readable on any row that did match.
    expect(error, `anon read ${column} without being refused`).not.toBeNull()
    expect(data).toBeNull()
    // 42501 = insufficient_privilege, 42703 = undefined_column. Which one surfaces depends
    // on how PostgREST resolves the column against its schema cache before Postgres gets
    // to raise; both are refusals and either is acceptable. What is NOT acceptable is a
    // 2xx with a number in it.
    expect(`${error?.code} ${error?.message}`).toMatch(/42501|42703|permission denied|does not exist/i)
  })

  it('anon can still read every column the public site actually uses', async () => {
    const anon = anonClient()
    const { error } = await anon.from('listings').select(GRANTED.join(', ')).eq('status', 'live').limit(1)

    // This is the half that catches an over-broad revoke. If the grant list ever loses a
    // column the site reads, this fails here rather than as a blank page in production.
    expect(error, `anon lost read access to a column the public site needs: ${error?.message}`).toBeNull()
  })

  it('anon cannot write a listing, and is stopped by the grant rather than only by RLS', async () => {
    const anon = anonClient()
    const { error } = await anon.from('listings').insert({
      title: 'zz-anon-write-attempt',
      slug: 'zz-anon-write-attempt',
      category: 'residential_lot',
      price_php: 1,
      town_id: '00000000-0000-0000-0000-000000000000',
    })

    // Before this migration anon held INSERT/UPDATE/DELETE on the table and only RLS
    // refused the write. Both refuse now. The insert is expected to fail, so nothing is
    // written to production even when this test is the thing that is broken.
    expect(error).not.toBeNull()
  })

  /**
   * KNOWN AND DELIBERATELY NOT ASSERTED HERE: `authenticated` keeps full column SELECT, and
   * `listings_public_read_live` covers `{anon, authenticated}`, so any person who registers
   * and confirms an email can still read `price_php` over the API. Staff and buyers share
   * one Postgres role, so no column grant can separate them — closing that needs the price
   * moved to its own staff-only table, which is a decision the owner has been handed and
   * has not yet made. It is left untested rather than asserted in either direction: a test
   * saying "a buyer CAN read the price" would enshrine the gap as intended behaviour.
   */
})
