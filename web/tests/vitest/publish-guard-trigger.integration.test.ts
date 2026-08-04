import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { staffClient, staffUserId, zzTitle, zzSlug } from './helpers'

/**
 * AC-27 (DB backstop), re-based on the transition matrix that replaced the
 * verification-events mechanism in
 * supabase/migrations/20260803110000_listing_encoding_v2_apply2.sql.
 *
 * The guarantees are the same three as before — no direct flip to `live`, no
 * birth-public INSERT, no skip straight to `sold` — but the reason has changed.
 * The old guard let any `-> live` through once two verification_events rows
 * existed for the listing, which meant `list -> live` was legal as long as the
 * paperwork was on file. The new guard has no paperwork to read: it enforces
 * the lifecycle graph itself (TRANSITIONS in web/lib/admin/queries.ts), so
 * approval is a PATH the row has to have walked, not evidence attached to it.
 *
 * The fourth test is the one that matters most operationally. The trigger is
 * `before insert or update of status`, so it fires on every ordinary form save —
 * the admin's UPDATE names `status` in its SET list whether or not the value
 * moved. `list -> list` is not an edge in the matrix, so without the early
 * return in the guard every routine save on every listing would raise. That is
 * the regression this file exists to catch.
 *
 * Every write attempt below except the no-op one fails, so the fixture stays a
 * plain, deletable `list` entry.
 */
describe('publish guard trigger: DB-level backstop (AC-27, transition matrix)', () => {
  let staff: SupabaseClient<Database>
  let staffId: string
  let townId: string
  let propertyTypeId: string
  let listingId: string

  beforeAll(async () => {
    staff = await staffClient()
    staffId = await staffUserId(staff)

    const { data: town, error: townError } = await staff.from('towns').select('id').limit(1).single()
    if (townError) throw townError
    townId = town.id

    const { data: type, error: typeError } = await staff
      .from('property_types')
      .select('id')
      .eq('slug', 'rlot')
      .single()
    if (typeError) throw typeError
    propertyTypeId = type.id

    const { data: listing, error } = await staff
      .from('listings')
      .insert({
        title: zzTitle('BT guard-trigger fixture'),
        slug: zzSlug('guard-trigger'),
        property_type_id: propertyTypeId,
        price_php: 100000,
        town_id: townId,
        status: 'list',
        created_by: staffId,
      })
      .select('id')
      .single()
    if (error) throw error
    listingId = listing.id
  })

  afterAll(async () => {
    const { error } = await staff.from('listings').delete().eq('id', listingId)
    if (error) {
      console.warn(`[residual-listing] ${listingId} could not be deleted: ${error.message}`)
    }
  })

  it('a list-status listing: direct UPDATE to live raises (list -> live is not an edge), status unchanged', async () => {
    const { error } = await staff.from('listings').update({ status: 'live' }).eq('id', listingId)
    expect(error).not.toBeNull()

    const { data } = await staff.from('listings').select('status').eq('id', listingId).single()
    expect(data?.status).toBe('list')
  })

  it('direct INSERT with status=live raises (no listing may be born public)', async () => {
    const { error, data } = await staff
      .from('listings')
      .insert({
        title: zzTitle('BT guard insert-live'),
        slug: zzSlug('guard-insert-live'),
        property_type_id: propertyTypeId,
        price_php: 100000,
        town_id: townId,
        status: 'live',
        created_by: staffId,
      })
      .select('id')

    expect(error).not.toBeNull()
    expect(data ?? []).toEqual([])
  })

  it('list -> sold direct (skipping live) raises', async () => {
    const { error } = await staff.from('listings').update({ status: 'sold' }).eq('id', listingId)
    expect(error).not.toBeNull()

    const { data } = await staff.from('listings').select('status').eq('id', listingId).single()
    expect(data?.status).toBe('list')
  })

  /**
   * THE NO-OP CASE. An ordinary save writes the status it read back alongside the
   * fields that actually changed; `old.status = new.status` must therefore pass
   * the matrix untouched, at every status including the terminal ones.
   *
   * Asserted on this `list` fixture rather than on a real live listing on purpose:
   * the twelve live rows are the production catalogue, and a test that writes to
   * them to prove a save works is a worse idea than the one it is proving. The
   * guard does not branch on WHICH status it is, only on whether the value moved,
   * so `list -> list` exercises the same early return that `live -> live` does.
   */
  it('a save that does not move the status succeeds, even though list -> list is not an edge', async () => {
    const note = `BT no-op save probe ${new Date().toISOString()}`

    const { data, error } = await staff
      .from('listings')
      .update({ status: 'list', description: note })
      .eq('id', listingId)
      .select('id, status, description')

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0].status).toBe('list')
    expect(data?.[0].description).toBe(note)
  })
})
