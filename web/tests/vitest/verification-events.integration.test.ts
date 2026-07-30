import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { staffClient, buyerClient, staffUserId, zzTitle, zzSlug } from './helpers'

/**
 * AC-22a/b (append-only) + the migration-C insert `with_check` negatives
 * (published forgery, actor spoofing, backdating) — all against real staff
 * sessions on the hosted project, per run-p4-admin addendum #13.
 *
 * The fixture listing ends up holding a verification_events row, which the
 * FK `ON DELETE RESTRICT` (migration C amendment) makes permanently
 * undeletable by staff — that RESTRICT guarantee is itself part of what this
 * suite proves. The id is reported as a residual for orchestrator cleanup.
 */
describe('verification_events: append-only + insert guards (AC-22, AC-27-adjacent policy negatives)', () => {
  let staff: SupabaseClient<Database>
  let staffId: string
  let buyerId: string
  let listingId: string
  let eventId: string

  beforeAll(async () => {
    staff = await staffClient()
    staffId = await staffUserId(staff)
    const buyer = await buyerClient()
    buyerId = await staffUserId(buyer)

    const { data: town, error: townError } = await staff.from('towns').select('id').limit(1).single()
    if (townError) throw townError

    const { data: listing, error: listingError } = await staff
      .from('listings')
      .insert({
        title: zzTitle('BT events fixture'),
        slug: zzSlug('events-fixture'),
        category: 'residential_lot',
        price_php: 100000,
        town_id: town.id,
        status: 'draft',
        created_by: staffId,
      })
      .select('id')
      .single()
    if (listingError) throw listingError
    listingId = listing.id

    const { data: event, error: eventError } = await staff
      .from('verification_events')
      .insert({
        listing_id: listingId,
        kind: 'title_check',
        performed_by: staffId,
        notes: 'BT harness fixture — safe to delete listing (blocked by RESTRICT, see report).',
      })
      .select('id')
      .single()
    if (eventError) throw eventError
    eventId = event.id
  })

  afterAll(async () => {
    const { error } = await staff.from('listings').delete().eq('id', listingId)
    if (error) {
      // Expected: the fixture carries a verification_events row, and the FK is
      // ON DELETE RESTRICT. Logged so the orchestrator sweeps it post-run.
      console.warn(`[residual-listing] ${listingId} undeletable (has events, RESTRICT): ${error.message}`)
    }
  })

  it('AC-22a: staff UPDATE on an existing event affects 0 rows', async () => {
    const { data, error } = await staff
      .from('verification_events')
      .update({ notes: 'tampered by BT' })
      .eq('id', eventId)
      .select('id')

    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: reread } = await staff
      .from('verification_events')
      .select('notes')
      .eq('id', eventId)
      .single()
    expect(reread?.notes).not.toBe('tampered by BT')
  })

  it('AC-22b: staff DELETE on an existing event affects 0 rows', async () => {
    const { data, error } = await staff
      .from('verification_events')
      .delete()
      .eq('id', eventId)
      .select('id')

    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: reread } = await staff
      .from('verification_events')
      .select('id')
      .eq('id', eventId)
      .maybeSingle()
    expect(reread).not.toBeNull()
  })

  it('policy negative: insert kind=published is denied (trigger-only event)', async () => {
    const { error } = await staff.from('verification_events').insert({
      listing_id: listingId,
      kind: 'published',
      performed_by: staffId,
    })
    expect(error).not.toBeNull()
  })

  it('policy negative: insert with performed_by = someone else is denied', async () => {
    const { error } = await staff.from('verification_events').insert({
      listing_id: listingId,
      kind: 'title_check',
      performed_by: buyerId,
    })
    expect(error).not.toBeNull()
  })

  it('policy negative: insert with a backdated occurred_at is denied', async () => {
    const past = new Date(Date.now() - 5 * 60_000).toISOString()
    const { error } = await staff.from('verification_events').insert({
      listing_id: listingId,
      kind: 'title_check',
      performed_by: staffId,
      occurred_at: past,
    })
    expect(error).not.toBeNull()
  })
})
