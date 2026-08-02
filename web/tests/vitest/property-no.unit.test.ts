import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  PROPERTY_NO_MAX,
  PROPERTY_NO_TAKEN,
  PropertyNoField,
  isPropertyNoConflict,
  normalisePropertyNo,
} from '@/lib/admin/property-no'
import { createListing, updateListing } from '@/app/admin/actions'

/**
 * Unit cover for the property number: the normalisation, the field schema, and the
 * reading of a unique violation — plus two properties that only the real actions can
 * prove, in the style `admin-invites.unit.test.ts` established.
 *
 * Those two are the ones a reviewer cannot check by reading the code once:
 *
 *   1. a CLEARED field reaches the database as `null` and never as `''`. `''` would fail
 *      the shape check outright, and if it ever did land it would collide with every other
 *      cleared listing on `upper(property_no)` — one blank listing would make the field
 *      unusable for everybody else.
 *   2. a 23505 raised by the property-number index is not mistaken for a slug collision.
 *      `listings` has two unique indexes an admin can trip and they share a SQLSTATE, so
 *      this is a routing decision, and getting it wrong in `createListing` produces four
 *      wasted retries and then a message about a title that was never the problem.
 *
 * Nothing here touches the database. The Supabase client, the mail door, the auth lookup
 * and the cache/redirect primitives are stood in for; everything under test stays real.
 */

const mocked = vi.hoisted(() => ({
  getStaffUser: vi.fn(),
  /** Reassigned per test by `useClient`, so the createClient mock sees the live stub. */
  client: null as unknown,
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocked.client }))

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    const signal = new Error(`NEXT_REDIRECT:${url}`) as Error & { redirectTo?: string }
    signal.redirectTo = url
    throw signal
  },
}))

vi.mock('@/lib/admin/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/auth')>()
  return { ...actual, getStaffUser: mocked.getStaffUser }
})

// ---------------------------------------------------------------------------
// The pure half
// ---------------------------------------------------------------------------

describe('normalisePropertyNo — what the database will actually store', () => {
  it('trims, because the check constraint refuses padding outright', () => {
    expect(normalisePropertyNo('  DS-0142  ')).toBe('DS-0142')
    expect(normalisePropertyNo('\tDS-0142\n')).toBe('DS-0142')
  })

  it('upper-cases, because the unique index is on upper(property_no)', () => {
    expect(normalisePropertyNo('ds-0142')).toBe('DS-0142')
    expect(normalisePropertyNo('Ds-0142')).toBe('DS-0142')
  })

  it('leaves an already-clean value exactly as it is', () => {
    expect(normalisePropertyNo('DS-0142')).toBe('DS-0142')
  })

  it('turns a cleared field into null, never into an empty string', () => {
    expect(normalisePropertyNo('')).toBeNull()
    expect(normalisePropertyNo('   ')).toBeNull()
    expect(normalisePropertyNo('\n\t')).toBeNull()
  })

  it('treats an absent field the same as a cleared one', () => {
    expect(normalisePropertyNo(null)).toBeNull()
    expect(normalisePropertyNo(undefined)).toBeNull()
    expect(normalisePropertyNo(12345)).toBeNull()
    expect(normalisePropertyNo({ property_no: 'DS-0142' })).toBeNull()
  })

  it('keeps the characters between the ends — only the ends are padding', () => {
    expect(normalisePropertyNo('  ds 0142  ')).toBe('DS 0142')
    expect(normalisePropertyNo('lot/4-b')).toBe('LOT/4-B')
  })
})

describe('PropertyNoField — the schema both listing forms share', () => {
  it('normalises on the way through', () => {
    const parsed = PropertyNoField.safeParse('  ds-0142 ')
    expect(parsed.success).toBe(true)
    if (!parsed.success) throw new Error('unreachable')
    expect(parsed.data).toBe('DS-0142')
  })

  it('accepts a blank field as null — the number is optional', () => {
    for (const value of ['', '   ', null, undefined]) {
      const parsed = PropertyNoField.safeParse(value)
      expect(parsed.success).toBe(true)
      if (!parsed.success) throw new Error('unreachable')
      expect(parsed.data).toBeNull()
    }
  })

  it('accepts exactly 24 characters and refuses 25 — the constraint boundary', () => {
    expect(PROPERTY_NO_MAX).toBe(24)
    expect(PropertyNoField.safeParse('A'.repeat(24)).success).toBe(true)

    const tooLong = PropertyNoField.safeParse('A'.repeat(25))
    expect(tooLong.success).toBe(false)
    if (tooLong.success) throw new Error('unreachable')
    expect(tooLong.error.issues[0].message).toMatch(/24 characters/)
  })

  it('measures the length AFTER trimming, so padding alone cannot fail a valid number', () => {
    expect(PropertyNoField.safeParse(`  ${'A'.repeat(24)}  `).success).toBe(true)
  })
})

describe('isPropertyNoConflict — which of the two unique indexes was hit', () => {
  it('is true for the constraint name PostgREST puts in the message', () => {
    expect(
      isPropertyNoConflict({
        code: '23505',
        message: 'duplicate key value violates unique constraint "listings_property_no_unique_idx"',
        details: null,
      })
    ).toBe(true)
  })

  it('is true for the column named in details instead', () => {
    expect(
      isPropertyNoConflict({
        code: '23505',
        message: 'duplicate key value violates unique constraint',
        details: 'Key (upper(property_no))=(DS-0142) already exists.',
      })
    ).toBe(true)
  })

  it('is FALSE for a slug collision — the case that must keep its own handling', () => {
    expect(
      isPropertyNoConflict({
        code: '23505',
        message: 'duplicate key value violates unique constraint "listings_slug_key"',
        details: 'Key (slug)=(corner-lot-lagao) already exists.',
      })
    ).toBe(false)
  })

  it('is false for any other SQLSTATE, however the message reads', () => {
    expect(isPropertyNoConflict({ code: '23514', message: 'property_no shape' })).toBe(false)
    expect(isPropertyNoConflict({ code: '42501', message: 'property_no' })).toBe(false)
    expect(isPropertyNoConflict({ code: null, message: 'property_no' })).toBe(false)
  })

  it('is false for nothing at all, rather than throwing', () => {
    expect(isPropertyNoConflict(null)).toBe(false)
    expect(isPropertyNoConflict(undefined)).toBe(false)
    expect(isPropertyNoConflict({})).toBe(false)
  })
})

describe('PROPERTY_NO_TAKEN — a friendly sentence, not a Postgres one', () => {
  it('says what happened in words a clerk can act on', () => {
    expect(PROPERTY_NO_TAKEN).toMatch(/already used by another listing/i)
  })

  it('names no table, constraint, index, column or SQLSTATE', () => {
    expect(PROPERTY_NO_TAKEN).not.toMatch(
      /constraint|violat|duplicate key|_idx|property_no|listings|pg_|SQLSTATE|235\d\d/i
    )
  })
})

// ---------------------------------------------------------------------------
// The two properties that only the real actions can prove
// ---------------------------------------------------------------------------

const STAFF = { id: '11111111-1111-4111-8111-111111111111', role: 'staff' as const }

const TOWN = '33333333-3333-4333-8333-333333333333'
const LISTING = '44444444-4444-4444-8444-444444444444'

type QueryResult = { data?: unknown; error?: unknown }

/**
 * The four calls the two actions make, and nothing else: an insert, the read of the
 * current row, an update, and whatever they chain off those.
 *
 * The builder records every payload it is handed, which is how the "reaches the database
 * as null" assertions are made — they read what was actually about to be written, not
 * what the schema said it would be.
 */
function makeClient(handlers: {
  insert?: (payload: Record<string, unknown>) => QueryResult
  read?: () => QueryResult
  update?: (payload: Record<string, unknown>) => QueryResult
}) {
  const inserts: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []

  const client = {
    from() {
      let verb: 'insert' | 'read' | 'update' = 'read'
      let payload: Record<string, unknown> = {}

      const settle = (): QueryResult => {
        if (verb === 'insert') return handlers.insert?.(payload) ?? { data: null, error: null }
        if (verb === 'update') return handlers.update?.(payload) ?? { data: null, error: null }
        return handlers.read?.() ?? { data: null, error: null }
      }

      const builder: Record<string, unknown> = {
        insert(value: Record<string, unknown>) {
          verb = 'insert'
          payload = value
          inserts.push(value)
          return builder
        },
        update(value: Record<string, unknown>) {
          verb = 'update'
          payload = value
          updates.push(value)
          return builder
        },
        select: () => builder,
        eq: () => builder,
        single: async () => settle(),
        maybeSingle: async () => settle(),
        then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(settle()).then(resolve, reject),
      }

      return builder
    },
  }

  return { client, inserts, updates }
}

/** Runs something that is expected to `redirect()`, and returns where it went. */
async function captureRedirect(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    const target = (error as { redirectTo?: string }).redirectTo
    if (typeof target === 'string') return target
    throw error
  }
  throw new Error('expected a redirect, and none happened')
}

function listingForm(fields: Record<string, string>): FormData {
  const fd = new FormData()
  fd.set('title', 'Corner Residential Lot, Lagao')
  fd.set('category', 'residential_lot')
  fd.set('price_php', '1500000')
  fd.set('town_id', TOWN)
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

const PROPERTY_NO_ERROR = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "listings_property_no_unique_idx"',
  details: 'Key (upper(property_no))=(DS-0142) already exists.',
}

const SLUG_ERROR = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "listings_slug_key"',
  details: 'Key (slug)=(corner-residential-lot-lagao) already exists.',
}

beforeEach(() => {
  mocked.getStaffUser.mockReset().mockResolvedValue(STAFF)
})

describe('createListing — the property number as it reaches the database', () => {
  it('writes a trimmed, upper-cased number', async () => {
    const stub = makeClient({ insert: () => ({ data: { id: LISTING }, error: null }) })
    mocked.client = stub.client

    await captureRedirect(() => createListing(null, listingForm({ property_no: '  ds-0142 ' })))

    expect(stub.inserts).toHaveLength(1)
    expect(stub.inserts[0].property_no).toBe('DS-0142')
  })

  it('writes NULL for a cleared field — never the empty string', async () => {
    const stub = makeClient({ insert: () => ({ data: { id: LISTING }, error: null }) })
    mocked.client = stub.client

    await captureRedirect(() => createListing(null, listingForm({ property_no: '   ' })))

    expect(stub.inserts[0].property_no).toBeNull()
    expect(stub.inserts[0].property_no).not.toBe('')
  })

  it('writes NULL when the field was not on the form at all', async () => {
    const stub = makeClient({ insert: () => ({ data: { id: LISTING }, error: null }) })
    mocked.client = stub.client

    await captureRedirect(() => createListing(null, listingForm({})))

    expect(stub.inserts[0].property_no).toBeNull()
  })

  it('maps a property-number collision to a field error, and does NOT retry the slug', async () => {
    const stub = makeClient({ insert: () => ({ data: null, error: PROPERTY_NO_ERROR }) })
    mocked.client = stub.client

    const result = await createListing(null, listingForm({ property_no: 'DS-0142' }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('conflict')
    expect(result.fieldErrors?.property_no).toBe(PROPERTY_NO_TAKEN)
    // One attempt. Four would end in a message about the title, which was never the problem.
    expect(stub.inserts).toHaveLength(1)
  })

  it('hands the typed number back so the redrawn form keeps it', async () => {
    const stub = makeClient({ insert: () => ({ data: null, error: PROPERTY_NO_ERROR }) })
    mocked.client = stub.client

    const result = await createListing(null, listingForm({ property_no: 'DS-0142' }))

    if (result.ok) throw new Error('unreachable')
    expect(result.values?.property_no).toBe('DS-0142')
    expect(result.values?.title).toBe('Corner Residential Lot, Lagao')
  })

  it('still retries a SLUG collision with a fresh suffix — the existing behaviour is untouched', async () => {
    let attempt = 0
    const stub = makeClient({
      insert: () => {
        attempt += 1
        return attempt === 1
          ? { data: null, error: SLUG_ERROR }
          : { data: { id: LISTING }, error: null }
      },
    })
    mocked.client = stub.client

    const target = await captureRedirect(() =>
      createListing(null, listingForm({ property_no: 'DS-0142' }))
    )

    expect(target).toBe(`/admin/listings/${LISTING}`)
    expect(stub.inserts).toHaveLength(2)
    expect(stub.inserts[0].slug).not.toBe(stub.inserts[1].slug)
  })

  it('never echoes the Postgres message or the index name', async () => {
    const stub = makeClient({ insert: () => ({ data: null, error: PROPERTY_NO_ERROR }) })
    mocked.client = stub.client

    const serialised = JSON.stringify(await createListing(null, listingForm({ property_no: 'DS-0142' })))

    expect(serialised).not.toContain('listings_property_no_unique_idx')
    expect(serialised).not.toContain('duplicate key')
    expect(serialised).not.toContain('23505')
  })
})

describe('updateListing — the same two rules on the edit screen', () => {
  const current = { data: { id: LISTING, slug: 'corner-lot-lagao', status: 'draft' }, error: null }

  it('clearing the number writes NULL, which releases the unique index', async () => {
    const stub = makeClient({ read: () => current, update: () => ({ data: null, error: null }) })
    mocked.client = stub.client

    const result = await updateListing(
      null,
      listingForm({ listingId: LISTING, property_no: '' })
    )

    expect(result.ok).toBe(true)
    expect(stub.updates).toHaveLength(1)
    expect(stub.updates[0].property_no).toBeNull()
  })

  it('a changed number is written trimmed and upper-cased', async () => {
    const stub = makeClient({ read: () => current, update: () => ({ data: null, error: null }) })
    mocked.client = stub.client

    await updateListing(null, listingForm({ listingId: LISTING, property_no: ' ds-0142' }))

    expect(stub.updates[0].property_no).toBe('DS-0142')
  })

  it('maps a property-number collision to that field, not to the web address', async () => {
    const stub = makeClient({ read: () => current, update: () => ({ error: PROPERTY_NO_ERROR }) })
    mocked.client = stub.client

    const result = await updateListing(
      null,
      listingForm({ listingId: LISTING, property_no: 'DS-0142' })
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fieldErrors?.property_no).toBe(PROPERTY_NO_TAKEN)
    expect(result.fieldErrors?.slug).toBeUndefined()
    expect(result.message).not.toMatch(/web address/i)
  })

  it('leaves a slug collision reading exactly as it did before', async () => {
    const stub = makeClient({ read: () => current, update: () => ({ error: SLUG_ERROR }) })
    mocked.client = stub.client

    const result = await updateListing(
      null,
      listingForm({ listingId: LISTING, property_no: 'DS-0142' })
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fieldErrors?.slug).toMatch(/web address/i)
    expect(result.fieldErrors?.property_no).toBeUndefined()
  })

  it('a number over 24 characters is refused before any write happens', async () => {
    const stub = makeClient({ read: () => current, update: () => ({ data: null, error: null }) })
    mocked.client = stub.client

    const result = await updateListing(
      null,
      listingForm({ listingId: LISTING, property_no: 'A'.repeat(25) })
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fieldErrors?.property_no).toMatch(/24 characters/)
    expect(stub.updates).toHaveLength(0)
  })
})
