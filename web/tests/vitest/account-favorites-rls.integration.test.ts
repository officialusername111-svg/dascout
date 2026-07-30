import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { staffClient, buyerClient, staffUserId, anonClient, zzTitle, zzSlug } from './helpers'

/**
 * C.9 — `favorites_own` RLS both directions (PLAN.md "Security invariants" #4;
 * run-p3-accounts.md schema facts: `favorites (profile_id, listing_id)` PK, RLS
 * `favorites_own ALL to authenticated on auth.uid() = profile_id`, no staff override).
 *
 * A draft-status listing is a fine FK target for `favorites.listing_id` — the table has
 * no status filter of its own, it only cares about `auth.uid() = profile_id` — so no
 * publish lifecycle is needed for this fixture, keeping it a plain deletable draft under
 * the production-visibility protocol.
 */
describe('favorites RLS: own-row write, cross-row read denial, anon opacity (C.9)', () => {
  let staff: SupabaseClient<Database>
  let staffId: string
  let buyer: SupabaseClient<Database>
  let buyerId: string
  let townId: string
  let listingId: string

  beforeAll(async () => {
    staff = await staffClient()
    staffId = await staffUserId(staff)
    buyer = await buyerClient()
    buyerId = await staffUserId(buyer)

    const { data: town, error: townError } = await staff.from('towns').select('id').limit(1).single()
    if (townError) throw townError
    townId = town.id

    const { data: listing, error } = await staff
      .from('listings')
      .insert({
        title: zzTitle('BT favorites-rls fixture'),
        slug: zzSlug('favorites-rls'),
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
    // Own-row cleanup first (the FK cascades on listing delete too, per SA-OQ-3, but
    // being explicit here keeps this suite independent of that fact holding forever).
    await staff.from('favorites').delete().eq('listing_id', listingId)
    await buyer.from('favorites').delete().eq('listing_id', listingId)
    const { error } = await staff.from('listings').delete().eq('id', listingId)
    if (error) console.warn(`[residual-listing] favorites-rls fixture ${listingId}: ${error.message}`)
  })

  it('buyer cannot INSERT a favorite row naming a different profile_id (42501)', async () => {
    const { error } = await buyer
      .from('favorites')
      .insert({ profile_id: staffId, listing_id: listingId })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it("buyer SELECT of another profile's favorites returns zero rows, not an error", async () => {
    // Seed a real favorite row owned by staff, under staff's own session (allowed: it is
    // their own row under `favorites_own`).
    const { error: insertError } = await staff
      .from('favorites')
      .insert({ profile_id: staffId, listing_id: listingId })
    expect(insertError).toBeNull()

    const { data, error } = await buyer
      .from('favorites')
      .select('listing_id')
      .eq('profile_id', staffId)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('anon sees no favorite rows at all for this listing', async () => {
    const anon = anonClient()
    const { data, error } = await anon.from('favorites').select('profile_id').eq('listing_id', listingId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("sanity: the buyer CAN read and write their OWN favorite row on the same listing", async () => {
    const { error: insertError } = await buyer
      .from('favorites')
      .insert({ profile_id: buyerId, listing_id: listingId })
    expect(insertError).toBeNull()

    const { data, error } = await buyer
      .from('favorites')
      .select('listing_id')
      .eq('profile_id', buyerId)
      .eq('listing_id', listingId)

    expect(error).toBeNull()
    expect(data).toEqual([{ listing_id: listingId }])
  })
})
