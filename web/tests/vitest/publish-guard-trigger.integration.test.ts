import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { staffClient, staffUserId, zzTitle, zzSlug } from './helpers'

/**
 * AC-27 (DB backstop) + the panel-extended bypasses (SS-1/CL-1): the guard
 * trigger must reject a direct-SQL flip to `live` without the two events,
 * a birth-public INSERT, and a draft->sold skip — even from a fully
 * authenticated staff connection with no app code in the loop.
 *
 * The fixture listing never acquires any verification_events row (every
 * write attempt here fails), so it stays a plain, deletable draft.
 */
describe('publish guard trigger: DB-level backstop (AC-27 + panel extension)', () => {
  let staff: SupabaseClient<Database>
  let staffId: string
  let townId: string
  let listingId: string

  beforeAll(async () => {
    staff = await staffClient()
    staffId = await staffUserId(staff)

    const { data: town, error: townError } = await staff.from('towns').select('id').limit(1).single()
    if (townError) throw townError
    townId = town.id

    const { data: listing, error } = await staff
      .from('listings')
      .insert({
        title: zzTitle('BT guard-trigger fixture'),
        slug: zzSlug('guard-trigger'),
        category: 'residential_lot',
        price_php: 100000,
        town_id: townId,
        status: 'draft',
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

  it('a verifying/draft listing missing both events: direct UPDATE to live raises, status unchanged', async () => {
    const { error } = await staff.from('listings').update({ status: 'live' }).eq('id', listingId)
    expect(error).not.toBeNull()

    const { data } = await staff.from('listings').select('status').eq('id', listingId).single()
    expect(data?.status).toBe('draft')
  })

  it('direct INSERT with status=live raises (a row born public cannot have events)', async () => {
    const { error, data } = await staff
      .from('listings')
      .insert({
        title: zzTitle('BT guard insert-live'),
        slug: zzSlug('guard-insert-live'),
        category: 'residential_lot',
        price_php: 100000,
        town_id: townId,
        status: 'live',
        created_by: staffId,
      })
      .select('id')

    expect(error).not.toBeNull()
    expect(data ?? []).toEqual([])
  })

  it('draft -> sold direct (skipping live) raises', async () => {
    const { error } = await staff.from('listings').update({ status: 'sold' }).eq('id', listingId)
    expect(error).not.toBeNull()

    const { data } = await staff.from('listings').select('status').eq('id', listingId).single()
    expect(data?.status).toBe('draft')
  })
})
