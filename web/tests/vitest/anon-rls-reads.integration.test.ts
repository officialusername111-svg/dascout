import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { staffClient, staffUserId, anonClient, zzTitle, zzSlug } from './helpers'

/**
 * AC-30 — list / for_approval / withdrawn must be invisible to an anonymous
 * client across all three tables that carry a listing's public-facing data.
 *
 * `withdrawn` USED to be reached by a direct UPDATE from `draft`, because the
 * old guard trigger only gated transitions *to* `live` and `sold`. Since
 * 20260803110000_listing_encoding_v2_apply2.sql the guard enforces the whole
 * lifecycle graph, and `list -> withdrawn` is not an edge in it — the only road
 * to `withdrawn` is through `live`, which is exactly the graph the admin screen
 * offers. So this fixture now walks list -> for_approval -> live -> withdrawn.
 *
 * The `live` step is one round trip wide and the listing has no photos and no
 * features at that point (both are attached afterwards, deliberately), so the
 * worst an anonymous visitor could catch is a bare ZZ-titled card for a few
 * hundred milliseconds. Same production-visibility trade-off, and the same
 * shape, as reorder-photos-rpc.integration.test.ts.
 */
describe('anon RLS: list/for_approval/withdrawn return zero rows on all three tables (AC-30)', () => {
  let staff: SupabaseClient<Database>
  let staffId: string
  let featureId: string
  const ids: Record<'list' | 'for_approval' | 'withdrawn', string> = {} as never

  beforeAll(async () => {
    staff = await staffClient()
    staffId = await staffUserId(staff)

    const { data: town, error: townError } = await staff.from('towns').select('id').limit(1).single()
    if (townError) throw townError

    const { data: feature, error: featureError } = await staff.from('features').select('id').limit(1).single()
    if (featureError) throw featureError
    featureId = feature.id

    // The route each fixture takes from `list` to the status it is meant to hold. Every
    // hop is an edge in the matrix `guard_listing_publish` enforces; there is no shortcut.
    const ROUTE = {
      list: [],
      for_approval: ['for_approval'],
      withdrawn: ['for_approval', 'live', 'withdrawn'],
    } as const

    for (const status of ['list', 'for_approval', 'withdrawn'] as const) {
      const { data: listing, error } = await staff
        .from('listings')
        .insert({
          title: zzTitle(`BT AC30 ${status}`),
          slug: zzSlug(`ac30-${status}`),
          category: 'residential_lot',
          price_php: 100000,
          town_id: town.id,
          status: 'list',
          created_by: staffId,
        })
        .select('id')
        .single()
      if (error) throw error
      ids[status] = listing.id

      for (const hop of ROUTE[status]) {
        const { error: updError } = await staff
          .from('listings')
          .update({ status: hop })
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

  const statuses = ['list', 'for_approval', 'withdrawn'] as const

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
