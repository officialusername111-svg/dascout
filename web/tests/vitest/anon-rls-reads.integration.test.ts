import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { staffClient, staffUserId, anonClient, zzTitle, zzSlug } from './helpers'

/**
 * AC-30 — draft / verifying / withdrawn must be invisible to an anonymous
 * client across all three tables that carry a listing's public-facing data.
 *
 * `withdrawn` is reached directly from `draft` here (not via a real publish):
 * the guard trigger only gates transitions *to* `live` and `sold`, so a plain
 * staff UPDATE to `withdrawn` is ungated at the DB level and never makes the
 * row (or its would-be photos) publicly visible even for a moment — the
 * safest possible fixture under the production-visibility protocol.
 */
describe('anon RLS: draft/verifying/withdrawn return zero rows on all three tables (AC-30)', () => {
  let staff: SupabaseClient<Database>
  let staffId: string
  let featureId: string
  const ids: Record<'draft' | 'verifying' | 'withdrawn', string> = {} as never

  beforeAll(async () => {
    staff = await staffClient()
    staffId = await staffUserId(staff)

    const { data: town, error: townError } = await staff.from('towns').select('id').limit(1).single()
    if (townError) throw townError

    const { data: feature, error: featureError } = await staff.from('features').select('id').limit(1).single()
    if (featureError) throw featureError
    featureId = feature.id

    for (const status of ['draft', 'verifying', 'withdrawn'] as const) {
      const { data: listing, error } = await staff
        .from('listings')
        .insert({
          title: zzTitle(`BT AC30 ${status}`),
          slug: zzSlug(`ac30-${status}`),
          category: 'residential_lot',
          price_php: 100000,
          town_id: town.id,
          status: 'draft',
          created_by: staffId,
        })
        .select('id')
        .single()
      if (error) throw error
      ids[status] = listing.id

      if (status !== 'draft') {
        const { error: updError } = await staff
          .from('listings')
          .update({ status })
          .eq('id', listing.id)
        if (updError) throw updError
      }

      const { error: photoError } = await staff.from('listing_photos').insert({
        listing_id: listing.id,
        storage_path: `listings/${listing.id}/${crypto.randomUUID()}.jpg`,
        sort_order: 0,
        is_primary: true,
      })
      if (photoError) throw photoError

      const { error: featureLinkError } = await staff
        .from('listing_features')
        .insert({ listing_id: listing.id, feature_id: featureId })
      if (featureLinkError) throw featureLinkError
    }
  })

  afterAll(async () => {
    for (const [status, id] of Object.entries(ids)) {
      await staff.from('listing_photos').delete().eq('listing_id', id)
      await staff.from('listing_features').delete().eq('listing_id', id)
      const { error } = await staff.from('listings').delete().eq('id', id)
      if (error) console.warn(`[residual-listing] (${status}) ${id}: ${error.message}`)
    }
  })

  const statuses = ['draft', 'verifying', 'withdrawn'] as const

  it.each(statuses)('anon sees 0 listings rows for a %s listing', async (status) => {
    const anon = anonClient()
    const { data, error } = await anon.from('listings').select('id').eq('id', ids[status])
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it.each(statuses)('anon sees 0 listing_photos rows for a %s listing', async (status) => {
    const anon = anonClient()
    const { data, error } = await anon.from('listing_photos').select('id').eq('listing_id', ids[status])
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it.each(statuses)('anon sees 0 listing_features rows for a %s listing', async (status) => {
    const anon = anonClient()
    const { data, error } = await anon.from('listing_features').select('feature_id').eq('listing_id', ids[status])
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
