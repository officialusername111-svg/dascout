import { describe, it, expect, beforeAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { staffClient, buyerClient, staffUserId, zzTitle, zzSlug } from './helpers'

/**
 * `public.reorder_listing_photos` (migration 20260729140300) — the single-transaction
 * RPC that replaced the five-round-trip app-side reorder behind AC-16/17. Two guards:
 *
 * - A submitted id set that doesn't exactly match the listing's current photos returns
 *   -1 (the app maps this to a `conflict`, same as before).
 * - The function is SECURITY INVOKER: RLS on `listing_photos` still gates the actual
 *   writes, so a non-staff caller's UPDATE matches 0 rows even with a correct-looking
 *   id set, and the function reports that honestly rather than pretending it worked.
 */
type ReorderRpcClient = {
  rpc(
    fn: 'reorder_listing_photos',
    args: { p_listing_id: string; p_photo_ids: string[] }
  ): PromiseLike<{ data: number | null; error: { code: string; message: string } | null }>
}

describe('reorder_listing_photos RPC guards', () => {
  let staff: SupabaseClient<Database>
  let staffId: string
  let townId: string

  beforeAll(async () => {
    staff = await staffClient()
    staffId = await staffUserId(staff)
    const { data: town, error } = await staff.from('towns').select('id').limit(1).single()
    if (error) throw error
    townId = town.id
  })

  it('staff session, wrong id set: returns -1 (id-set mismatch, no write)', async () => {
    const { data: listing, error } = await staff
      .from('listings')
      .insert({
        title: zzTitle('BT rpc mismatch fixture'),
        slug: zzSlug('rpc-mismatch'),
        category: 'residential_lot',
        price_php: 100000,
        town_id: townId,
        status: 'draft',
        created_by: staffId,
      })
      .select('id')
      .single()
    if (error) throw error
    const listingId = listing.id

    const { error: photoError } = await staff.from('listing_photos').insert({
      listing_id: listingId,
      storage_path: `listings/${listingId}/${crypto.randomUUID()}.jpg`,
      sort_order: 0,
      is_primary: true,
    })
    if (photoError) throw photoError

    const { data: written, error: rpcError } = await (staff as unknown as ReorderRpcClient).rpc(
      'reorder_listing_photos',
      { p_listing_id: listingId, p_photo_ids: [crypto.randomUUID()] } // not the real photo id
    )
    expect(rpcError).toBeNull()
    expect(written).toBe(-1)

    // No events were ever recorded — plain deletable draft cleanup.
    const { error: delError } = await staff.from('listings').delete().eq('id', listingId)
    if (delError) console.warn(`[residual-listing] rpc-mismatch fixture ${listingId}: ${delError.message}`)
  })

  it('buyer session, correct-looking id set on a live listing: returns 0 rows written (RLS blocks the write)', async () => {
    const buyer = await buyerClient()

    const { data: listing, error } = await staff
      .from('listings')
      .insert({
        title: zzTitle('BT rpc buyer-denied fixture'),
        slug: zzSlug('rpc-buyer-denied'),
        category: 'residential_lot',
        price_php: 100000,
        town_id: townId,
        status: 'draft',
        created_by: staffId,
      })
      .select('id')
      .single()
    if (error) throw error
    const listingId = listing.id

    // The trigger requires both fieldwork events before a direct flip to `live` is
    // even possible — same mechanism proven in publish-guard-trigger.integration.test.ts.
    const { error: eventError } = await staff.from('verification_events').insert([
      { listing_id: listingId, kind: 'title_check', performed_by: staffId, notes: 'RPC guard fixture.' },
      {
        listing_id: listingId,
        kind: 'ground_validation',
        performed_by: staffId,
        notes: 'RPC guard fixture, ten+ chars.',
      },
    ])
    if (eventError) throw eventError

    const { data: photo, error: photoError } = await staff
      .from('listing_photos')
      .insert({
        listing_id: listingId,
        storage_path: `listings/${listingId}/${crypto.randomUUID()}.jpg`,
        sort_order: 0,
        is_primary: true,
      })
      .select('id')
      .single()
    if (photoError) throw photoError

    try {
      // Live only for the few hundred ms this assertion needs, per the
      // production-visibility protocol — withdrawn again in the finally block below.
      const { error: liveError } = await staff.from('listings').update({ status: 'live' }).eq('id', listingId)
      if (liveError) throw liveError

      const { data: written, error: rpcError } = await (buyer as unknown as ReorderRpcClient).rpc(
        'reorder_listing_photos',
        { p_listing_id: listingId, p_photo_ids: [photo.id] } // the real, current set — id-set check passes
      )
      expect(rpcError).toBeNull()
      expect(written).toBe(0)

      // Confirm the row itself is untouched (RLS denied the write, not a silent no-op).
      const { data: unchanged } = await staff
        .from('listing_photos')
        .select('is_primary, sort_order')
        .eq('id', photo.id)
        .single()
      expect(unchanged?.is_primary).toBe(true)
      expect(unchanged?.sort_order).toBe(0)
    } finally {
      const { error: withdrawError } = await staff
        .from('listings')
        .update({ status: 'withdrawn' })
        .eq('id', listingId)
      if (withdrawError) console.warn(`[cleanup] could not withdraw rpc-buyer-denied fixture: ${withdrawError.message}`)
      console.log(`[residual-listing] rpc-buyer-denied fixture ${listingId} ends withdrawn; has events, undeletable (RESTRICT).`)
    }
  })
})
