import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { staffClient, buyerClient, staffUserId, anonClient, zzTitle, zzSlug } from './helpers'

/**
 * D.17/D.18/D.19 — `listing_views` after migrations 20260730060000/060100/060300
 * (run-p3-accounts.md schema facts + CONTRACT.md §4 A9 body):
 *
 * - `listing_views_own_read`: a buyer may SELECT rows where `profile_id = auth.uid()`,
 *   nothing else — the existing staff-only read stays untouched.
 * - The buyer UPDATE surface is now provably gone entirely: the interim
 *   `listing_views_own_detach` policy AND its column grant were dropped in
 *   `20260730060300` (BD verify cycle 1 — a filtered UPDATE can never pass RLS on the
 *   resulting null-owned row, so the policy was dead code; removed rather than left as
 *   surface nobody can use).
 * - `clear_my_listing_views()` is the SECURITY DEFINER function that is the only
 *   de-attach door left: it zeroes the caller's own `profile_id`s, self-scoped to
 *   `auth.uid()`, and is not executable by `anon`.
 *
 * The listing needs `status in ('live','sold')` to accept an INSERT into `listing_views`
 * at all (`listing_views_insert_visible`), so this fixture goes live for the few seconds
 * the suite needs and is withdrawn again in `afterAll` — same pattern as
 * `reorder-photos-rpc.integration.test.ts` and `verification-events.integration.test.ts`.
 */
describe('listing_views RLS + clear_my_listing_views RPC (D.17/D.18/D.19)', () => {
  let staff: SupabaseClient<Database>
  let staffId: string
  let buyer: SupabaseClient<Database>
  let buyerId: string
  let listingId: string
  let buyerRowId: string
  let staffRowId: string

  beforeAll(async () => {
    staff = await staffClient()
    staffId = await staffUserId(staff)
    buyer = await buyerClient()
    buyerId = await staffUserId(buyer)

    const { data: town, error: townError } = await staff.from('towns').select('id').limit(1).single()
    if (townError) throw townError

    const { data: listing, error } = await staff
      .from('listings')
      .insert({
        title: zzTitle('BT listing-views-rls fixture'),
        slug: zzSlug('listing-views-rls'),
        category: 'residential_lot',
        price_php: 100000,
        town_id: town.id,
        status: 'draft',
        created_by: staffId,
      })
      .select('id')
      .single()
    if (error) throw error
    listingId = listing.id

    // The guard trigger only gates transitions *to* live/sold — both fieldwork events
    // are required first (same mechanism as publish-guard-trigger.integration.test.ts).
    const { error: eventError } = await staff.from('verification_events').insert([
      { listing_id: listingId, kind: 'title_check', performed_by: staffId, notes: 'BT history-RLS fixture.' },
      {
        listing_id: listingId,
        kind: 'ground_validation',
        performed_by: staffId,
        notes: 'BT history-RLS fixture, ten+ chars.',
      },
    ])
    if (eventError) throw eventError

    const { error: liveError } = await staff.from('listings').update({ status: 'live' }).eq('id', listingId)
    if (liveError) throw liveError

    const { data: buyerRow, error: buyerInsertError } = await buyer
      .from('listing_views')
      .insert({
        listing_id: listingId,
        profile_id: buyerId,
        session_hash: `zz-bt-buyer-${crypto.randomUUID()}`,
      })
      .select('id')
      .single()
    if (buyerInsertError) throw buyerInsertError
    buyerRowId = buyerRow.id

    const { data: staffRow, error: staffInsertError } = await staff
      .from('listing_views')
      .insert({
        listing_id: listingId,
        profile_id: staffId,
        session_hash: `zz-bt-staff-${crypto.randomUUID()}`,
      })
      .select('id')
      .single()
    if (staffInsertError) throw staffInsertError
    staffRowId = staffRow.id
  })

  afterAll(async () => {
    // `verification_events` FK is ON DELETE RESTRICT, so this fixture is permanently
    // undeletable once it has events — withdraw it so nothing this run created is public
    // for longer than the assertions need, and report the residual for orchestrator sweep.
    const { error: withdrawError } = await staff
      .from('listings')
      .update({ status: 'withdrawn' })
      .eq('id', listingId)
    if (withdrawError) console.warn(`[cleanup] could not withdraw listing-views-rls fixture: ${withdrawError.message}`)
    console.log(`[residual-listing] listing-views-rls fixture ${listingId} ends withdrawn; has events, undeletable (RESTRICT).`)
  })

  it("D.17: buyer reads own listing_views row, not the other person's", async () => {
    const { data: own, error: ownError } = await buyer
      .from('listing_views')
      .select('id, profile_id')
      .eq('id', buyerRowId)
    expect(ownError).toBeNull()
    expect(own).toEqual([{ id: buyerRowId, profile_id: buyerId }])

    const { data: others, error: othersError } = await buyer
      .from('listing_views')
      .select('id')
      .eq('id', staffRowId)
    expect(othersError).toBeNull()
    expect(others).toEqual([])
  })

  it('D.17: staff read policy is unaffected — staff still sees both rows for this listing', async () => {
    const { data, error } = await staff
      .from('listing_views')
      .select('id')
      .eq('listing_id', listingId)
      .in('id', [buyerRowId, staffRowId])
    expect(error).toBeNull()
    expect(data?.length).toBe(2)
  })

  it('D.18: a buyer direct UPDATE setting profile_id = null on their own row is refused', async () => {
    const { error, data } = await buyer
      .from('listing_views')
      .update({ profile_id: null })
      .eq('id', buyerRowId)
      .select('id')
    expect(error).not.toBeNull()
    expect(data ?? []).toEqual([])

    const { data: unchanged } = await staff
      .from('listing_views')
      .select('profile_id')
      .eq('id', buyerRowId)
      .single()
    expect(unchanged?.profile_id).toBe(buyerId)
  })

  it('D.18: a buyer direct UPDATE touching viewed_at on their own row is refused', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const { error, data } = await buyer
      .from('listing_views')
      .update({ viewed_at: future })
      .eq('id', buyerRowId)
      .select('id')
    expect(error).not.toBeNull()
    expect(data ?? []).toEqual([])
  })

  it('D.19: clear_my_listing_views detaches the caller\'s rows to profile_id=null; total row count is unchanged', async () => {
    const { data: before, error: beforeError } = await staff
      .from('listing_views')
      .select('id')
      .eq('listing_id', listingId)
    if (beforeError) throw beforeError
    const beforeCount = before?.length ?? 0

    const { error: rpcError } = await buyer.rpc('clear_my_listing_views')
    expect(rpcError).toBeNull()

    // The caller's own row(s) drop to profile_id null...
    const { data: mine, error: mineError } = await buyer
      .from('listing_views')
      .select('id')
      .eq('id', buyerRowId)
    expect(mineError).toBeNull()
    expect(mine).toEqual([]) // no longer visible to the buyer's own read policy — it is nobody's now

    const { data: afterRow, error: afterRowError } = await staff
      .from('listing_views')
      .select('profile_id')
      .eq('id', buyerRowId)
      .single()
    expect(afterRowError).toBeNull()
    expect(afterRow?.profile_id).toBeNull()

    // ...but the row itself, and the staff-owned row, both still exist: the view still
    // counts, only the personal association is gone.
    const { data: after, error: afterError } = await staff
      .from('listing_views')
      .select('id')
      .eq('listing_id', listingId)
    if (afterError) throw afterError
    expect(after?.length ?? 0).toBe(beforeCount)

    const { data: staffStill } = await staff.from('listing_views').select('profile_id').eq('id', staffRowId).single()
    expect(staffStill?.profile_id).toBe(staffId)
  })

  it('D.19: anon cannot call clear_my_listing_views at all', async () => {
    const anon = anonClient()
    const { error } = await anon.rpc('clear_my_listing_views')
    expect(error).not.toBeNull()
  })
})
