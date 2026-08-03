import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BUILT_IN_TYPE_BLOCKED,
  CreateFeatureSchema,
  CreatePropertyTypeSchema,
  CreateTownSchema,
  FEATURE_SLUG_TAKEN,
  NAV_GROUPS,
  PROPERTY_TYPE_ICONS,
  TYPE_NAME_TAKEN,
  TYPE_SLUG_TAKEN,
  UpdateFeatureSchema,
  UpdatePropertyTypeSchema,
  UpdateTownSchema,
  conflictField,
  deleteRaceMessage,
  inUseMessage,
  listingCountLabel,
  navGroupLabel,
} from '@/lib/admin/settings'
import {
  createFeature,
  createPropertyType,
  createTown,
  deleteFeature,
  deletePropertyType,
  deleteTown,
  updateFeature,
  updatePropertyType,
  updateTown,
} from '@/app/admin/settings-actions'

/**
 * listing encoding v2, piece 2 — the settings screen's nine writes and the pure rules
 * behind them.
 *
 * Nothing here touches a database. The Supabase client is a recorder: every call is
 * captured as a table, an operation, a payload and a set of filters, and the test asserts
 * what the action WOULD have sent. That is the right level for these, because the
 * properties that matter are all about what does and does not reach the wire:
 *
 *   * `legacy_category` never appears in any payload — it is the transition join key for
 *     the five seeded rows and a type created here must leave it NULL;
 *   * `slug` never appears in an UPDATE payload, whatever the form posts — it is the
 *     public URL key for `?cat=` and `?feat=` and every saved link depends on it standing
 *     still;
 *   * a delete whose row is in use never issues the DELETE at all, and a built-in property
 *     type is refused before the count is even asked for.
 *
 * The database enforces the last of those independently (ON DELETE RESTRICT on both
 * foreign keys). These tests are about the layer above it: the sentence the clerk reads
 * instead of a SQLSTATE.
 */

const mocked = vi.hoisted(() => ({
  calls: [] as MockCall[],
  reply: vi.fn(),
  getStaffUser: vi.fn(),
}))

type MockCall = {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  columns?: string
  options?: { count?: string; head?: boolean }
  payload?: Record<string, unknown>
  filters: Record<string, unknown>
}

type Reply = { data?: unknown; error?: unknown; count?: number }

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const call: MockCall = { table, op: 'select', filters: {} }
      mocked.calls.push(call)

      const chain = {
        select(columns?: string, options?: { count?: string; head?: boolean }) {
          call.columns = columns
          call.options = options
          return chain
        },
        insert(payload: Record<string, unknown>) {
          call.op = 'insert'
          call.payload = payload
          return chain
        },
        update(payload: Record<string, unknown>) {
          call.op = 'update'
          call.payload = payload
          return chain
        },
        delete() {
          call.op = 'delete'
          return chain
        },
        eq(column: string, value: unknown) {
          call.filters[column] = value
          return chain
        },
        single: async () => mocked.reply(call) as Reply,
        maybeSingle: async () => mocked.reply(call) as Reply,
        then<T>(
          onFulfilled?: ((value: Reply) => T) | null,
          onRejected?: ((reason: unknown) => T) | null
        ) {
          return Promise.resolve(mocked.reply(call) as Reply).then(onFulfilled, onRejected)
        },
      }

      return chain
    },
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

vi.mock('@/lib/admin/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/auth')>()
  return { ...actual, getStaffUser: mocked.getStaffUser }
})

const STAFF = { id: 'staff-id', email: 'staff@dascout.local', fullName: 'Staff', role: 'staff' }
const ROW_ID = '11111111-2222-4333-8444-555555555555'
const NEW_ID = '99999999-8888-4777-8666-555555555555'

/** The row a `select ... maybeSingle()` answers with, per table. Overridden per test. */
const rows: Record<string, Record<string, unknown> | null> = {
  property_types: { id: ROW_ID, name: 'Beach Property', legacy_category: null },
  towns: { id: ROW_ID, name: 'Polomolok' },
  features: { id: ROW_ID, name: 'Fenced' },
}

/** How many listings / links the count query reports. */
let usageCount = 0

function defaultReply(call: MockCall): Reply {
  if (call.op === 'insert') return { data: { id: NEW_ID }, error: null }
  if (call.op === 'update' || call.op === 'delete') return { data: [{ id: ROW_ID }], error: null }
  if (call.options?.head) return { data: null, count: usageCount, error: null }
  return { data: rows[call.table] ?? null, error: null }
}

function formOf(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

const TYPE_FORM = {
  name: 'Beach Property',
  plural_name: 'Beach Properties',
  slug: 'beach-property',
  icon: 'pin',
  group_key: 'lots',
  sort_order: '60',
  is_active: 'active',
}

const TOWN_FORM = { name: 'Polomolok', province: 'South Cotabato', slug: 'polomolok' }

const FEATURE_FORM = { name: 'Fenced', slug: 'fenced', sort_order: '40', is_active: 'active' }

const writes = () => mocked.calls.filter((call) => call.op !== 'select')

beforeEach(() => {
  mocked.calls.length = 0
  usageCount = 0
  rows.property_types = { id: ROW_ID, name: 'Beach Property', legacy_category: null }
  rows.towns = { id: ROW_ID, name: 'Polomolok' }
  rows.features = { id: ROW_ID, name: 'Fenced' }
  mocked.reply.mockReset().mockImplementation(defaultReply)
  mocked.getStaffUser.mockReset().mockResolvedValue(STAFF)
})

// ===========================================================================
// The pure rules
// ===========================================================================

describe('navGroupLabel — stored keys, displayed words', () => {
  it('maps the two stored keys and null', () => {
    expect(navGroupLabel(null)).toBe('Ungrouped')
    expect(navGroupLabel('lots')).toBe('Lots')
    expect(navGroupLabel('bldgs')).toBe('Buildings')
  })

  /**
   * Degradation-safe, as §1 of the apply-1 migration requires: a key the UI has no label
   * for renders as itself rather than vanishing from the screen.
   */
  it('renders an unknown key as itself rather than as a blank', () => {
    expect(navGroupLabel('coastal')).toBe('coastal')
  })

  it('offers the STORED keys as option values, never the display words', () => {
    expect(NAV_GROUPS.map((group) => group.value)).toEqual(['', 'lots', 'bldgs'])
    expect(NAV_GROUPS.map((group) => group.label)).toEqual(['Ungrouped', 'Lots', 'Buildings'])
  })
})

describe('PROPERTY_TYPE_ICONS — every option is a real sprite id', () => {
  /**
   * The defect this catches is invisible: `components/Icon.tsx` renders
   * `<use href="#i-{icon}">`, and a name the sprite does not carry draws nothing at all —
   * no error, no fallback, just an empty square on the row. So the list is checked against
   * the sprite file itself rather than against a copy of it.
   */
  it('is a subset of the ids the sprite actually defines', () => {
    const sprite = readFileSync(
      path.join(process.cwd(), 'components', 'IconSprite.tsx'),
      'utf8'
    )
    const ids = new Set([...sprite.matchAll(/id="i-([a-z-]+)"/g)].map((match) => match[1]))

    expect(ids.size).toBeGreaterThan(20)
    for (const icon of PROPERTY_TYPE_ICONS) {
      expect(ids.has(icon), `sprite has no #i-${icon}`).toBe(true)
    }
  })

  it('still offers the five icons the seeded types already use', () => {
    for (const icon of ['pin', 'tag', 'area', 'home', 'key']) {
      expect(PROPERTY_TYPE_ICONS).toContain(icon)
    }
  })
})

describe('CreatePropertyTypeSchema — what the form may and may not say', () => {
  it('accepts a well-formed entry and normalises it', () => {
    const parsed = CreatePropertyTypeSchema.parse({
      ...TYPE_FORM,
      name: '  Beach Property  ',
      slug: 'Beach-Property',
    })
    expect(parsed.name).toBe('Beach Property')
    expect(parsed.slug).toBe('beach-property')
    expect(parsed.is_active).toBe(true)
    expect(parsed.sort_order).toBe(60)
  })

  it('turns the blank nav group into NULL rather than an empty string', () => {
    expect(CreatePropertyTypeSchema.parse({ ...TYPE_FORM, group_key: '' }).group_key).toBeNull()
  })

  it('refuses a nav group that is not one of the two stored keys', () => {
    const parsed = CreatePropertyTypeSchema.safeParse({ ...TYPE_FORM, group_key: 'Lots' })
    expect(parsed.success).toBe(false)
  })

  it('refuses an icon the sprite does not carry', () => {
    expect(CreatePropertyTypeSchema.safeParse({ ...TYPE_FORM, icon: 'castle' }).success).toBe(false)
    expect(CreatePropertyTypeSchema.safeParse({ ...TYPE_FORM, icon: 'facebook' }).success).toBe(
      false
    )
  })

  it('refuses a key with spaces, capitals it cannot fold, or stray punctuation', () => {
    for (const slug of ['beach property', 'beach_property', 'beach--property', '-beach', 'b']) {
      expect(CreatePropertyTypeSchema.safeParse({ ...TYPE_FORM, slug }).success, slug).toBe(false)
    }
  })

  it('defaults a blank sort order to 100 and refuses a non-number or an out-of-range one', () => {
    expect(CreatePropertyTypeSchema.parse({ ...TYPE_FORM, sort_order: '' }).sort_order).toBe(100)
    expect(CreatePropertyTypeSchema.safeParse({ ...TYPE_FORM, sort_order: 'first' }).success).toBe(
      false
    )
    expect(CreatePropertyTypeSchema.safeParse({ ...TYPE_FORM, sort_order: '1000' }).success).toBe(
      false
    )
    expect(CreatePropertyTypeSchema.safeParse({ ...TYPE_FORM, sort_order: '-1' }).success).toBe(
      false
    )
  })

  /**
   * A missing status must be a refusal, not a default. A checkbox posts nothing when it is
   * unticked, so a dropped field and "make this inactive" would otherwise be the same
   * submission — and a lost field would silently archive a row.
   */
  it('refuses a missing or unknown status rather than defaulting it', () => {
    expect(CreatePropertyTypeSchema.safeParse({ ...TYPE_FORM, is_active: undefined }).success).toBe(
      false
    )
    expect(CreatePropertyTypeSchema.safeParse({ ...TYPE_FORM, is_active: 'on' }).success).toBe(false)
  })

  it('has no legacy_category field — a posted one is dropped, never written', () => {
    const parsed = CreatePropertyTypeSchema.parse({
      ...TYPE_FORM,
      legacy_category: 'farm_land',
      id: ROW_ID,
    })
    expect(Object.keys(parsed).sort()).toEqual(
      ['group_key', 'icon', 'is_active', 'name', 'plural_name', 'slug', 'sort_order'].sort()
    )
  })

  it('reports each failure as a sentence, not a type name', () => {
    const parsed = CreatePropertyTypeSchema.safeParse({ ...TYPE_FORM, name: '' })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('unreachable')
    expect(parsed.error.issues[0].message).toMatch(/[a-z] [a-z]/)
  })
})

describe('the three update schemas carry no slug at all', () => {
  it('drops a posted slug on a property type, a town and a feature', () => {
    const type = UpdatePropertyTypeSchema.parse({ ...TYPE_FORM, id: ROW_ID, slug: 'hijacked' })
    const town = UpdateTownSchema.parse({
      ...TOWN_FORM,
      id: ROW_ID,
      is_active: 'active',
      slug: 'hijacked',
    })
    const feature = UpdateFeatureSchema.parse({ ...FEATURE_FORM, id: ROW_ID, slug: 'hijacked' })

    expect('slug' in type).toBe(false)
    expect('slug' in town).toBe(false)
    expect('slug' in feature).toBe(false)
  })

  it('still refuses an id that is not a uuid', () => {
    expect(UpdatePropertyTypeSchema.safeParse({ ...TYPE_FORM, id: 'nope' }).success).toBe(false)
    expect(UpdateTownSchema.safeParse({ ...TOWN_FORM, id: 'nope', is_active: 'active' }).success).toBe(
      false
    )
    expect(UpdateFeatureSchema.safeParse({ ...FEATURE_FORM, id: 'nope' }).success).toBe(false)
  })
})

describe('the town and feature create schemas', () => {
  it('trim and require both halves of a town', () => {
    const parsed = CreateTownSchema.parse({ ...TOWN_FORM, name: ' Polomolok ' })
    expect(parsed.name).toBe('Polomolok')
    expect(CreateTownSchema.safeParse({ ...TOWN_FORM, province: '' }).success).toBe(false)
  })

  it('hold a feature to the same key rule as a property type', () => {
    expect(CreateFeatureSchema.parse({ ...FEATURE_FORM, slug: 'Fenced' }).slug).toBe('fenced')
    expect(CreateFeatureSchema.safeParse({ ...FEATURE_FORM, slug: 'all documents' }).success).toBe(
      false
    )
  })
})

describe('conflictField — which unique index raised the 23505', () => {
  it('reads slug and name out of either half of the error', () => {
    expect(conflictField({ message: 'duplicate key value violates unique constraint "features_slug_key"' })).toBe('slug')
    expect(conflictField({ message: 'duplicate key', details: 'Key (name)=(Fenced) already exists.' })).toBe('name')
    expect(conflictField({ message: 'duplicate key value violates unique constraint "towns_name_province_key"' })).toBe('name')
  })

  it('answers null rather than guessing when neither is named', () => {
    expect(conflictField({ message: 'duplicate key value violates some other index' })).toBeNull()
    expect(conflictField(null)).toBeNull()
    expect(conflictField(undefined)).toBeNull()
  })
})

describe('the sentences a refusal is reported with', () => {
  it('never says "1 listings"', () => {
    expect(listingCountLabel(1)).toBe('1 listing')
    expect(listingCountLabel(4)).toBe('4 listings')
  })

  it('names the row and the count, and says what to do about it', () => {
    expect(inUseMessage('feature', 'Titled', 4)).toContain('4 listings')
    expect(inUseMessage('feature', 'Titled', 4)).toMatch(/Remove it from those listings first/)
    expect(inUseMessage('town', 'Polomolok', 1)).toMatch(/1 listing still uses it/)
    expect(inUseMessage('property type', 'Farm Land', 2)).toMatch(/Move those listings/)
  })

  it('tells a race apart from a blocked delete — one says reload, the other says what to remove', () => {
    expect(deleteRaceMessage('Titled')).toMatch(/Reload the page/)
    expect(deleteRaceMessage('Titled')).not.toMatch(/listings still/)
  })

  it('explains why a built-in type cannot be deleted and offers the alternative', () => {
    expect(BUILT_IN_TYPE_BLOCKED).toMatch(/built-in/i)
    expect(BUILT_IN_TYPE_BLOCKED).toMatch(/Inactive/)
  })
})

// ===========================================================================
// Authorisation — the same guard on all nine
// ===========================================================================

describe('every action refuses a caller who is not staff, before any database call', () => {
  const cases: [string, (fd: FormData) => Promise<unknown>, Record<string, string>][] = [
    ['createPropertyType', (fd) => createPropertyType(null, fd), TYPE_FORM],
    ['updatePropertyType', (fd) => updatePropertyType(null, fd), { ...TYPE_FORM, id: ROW_ID }],
    ['deletePropertyType', (fd) => deletePropertyType(null, fd), { id: ROW_ID }],
    ['createTown', (fd) => createTown(null, fd), TOWN_FORM],
    ['updateTown', (fd) => updateTown(null, fd), { ...TOWN_FORM, id: ROW_ID, is_active: 'active' }],
    ['deleteTown', (fd) => deleteTown(null, fd), { id: ROW_ID }],
    ['createFeature', (fd) => createFeature(null, fd), FEATURE_FORM],
    ['updateFeature', (fd) => updateFeature(null, fd), { ...FEATURE_FORM, id: ROW_ID }],
    ['deleteFeature', (fd) => deleteFeature(null, fd), { id: ROW_ID }],
  ]

  it.each(cases)('%s answers forbidden and touches nothing', async (_name, run, fields) => {
    mocked.getStaffUser.mockResolvedValue(null)

    const result = (await run(formOf(fields))) as { ok: boolean; code?: string; message: string }

    expect(result.ok).toBe(false)
    expect(result.code).toBe('forbidden')
    expect(result.message).toBe('You need a staff account to do that.')
    expect(mocked.calls).toHaveLength(0)
  })

  it.each(cases)('%s uses the SAME denial sentence for a buyer as for a stranger', async (_n, run, fields) => {
    mocked.getStaffUser.mockResolvedValue(null)
    const first = (await run(formOf(fields))) as { message: string }
    const second = (await run(formOf(fields))) as { message: string }
    expect(first.message).toBe(second.message)
  })
})

// ===========================================================================
// Property types
// ===========================================================================

describe('createPropertyType', () => {
  it('inserts exactly the fields the form owns', async () => {
    const result = await createPropertyType(null, formOf(TYPE_FORM))

    expect(result.ok).toBe(true)
    expect(writes()).toHaveLength(1)
    expect(writes()[0].table).toBe('property_types')
    expect(writes()[0].payload).toEqual({
      name: 'Beach Property',
      plural_name: 'Beach Properties',
      slug: 'beach-property',
      icon: 'pin',
      group_key: 'lots',
      sort_order: 60,
      is_active: true,
    })
  })

  /**
   * The one that protects apply 3. `legacy_category` maps a type back to the
   * `listing_category` enum; only the five seeded rows have one, and a type created here
   * must leave it NULL. A form that could set it would let somebody claim a sixth type is
   * one of the five.
   */
  it('never writes legacy_category, even when the form posts one', async () => {
    await createPropertyType(null, formOf({ ...TYPE_FORM, legacy_category: 'farm_land' }))

    expect(writes()[0].payload).not.toHaveProperty('legacy_category')
    expect(JSON.stringify(writes()[0].payload)).not.toContain('farm_land')
  })

  it('sends the stored nav key, never the word on the screen', async () => {
    await createPropertyType(null, formOf({ ...TYPE_FORM, group_key: 'bldgs' }))
    expect(writes()[0].payload?.group_key).toBe('bldgs')

    mocked.calls.length = 0
    await createPropertyType(null, formOf({ ...TYPE_FORM, group_key: '' }))
    expect(writes()[0].payload?.group_key).toBeNull()
  })

  it('rejects a bad key without going near the database', async () => {
    const result = await createPropertyType(null, formOf({ ...TYPE_FORM, slug: 'Beach Property!' }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('validation')
    expect(result.fieldErrors?.slug).toBeDefined()
    expect(mocked.calls).toHaveLength(0)
  })

  it('hands the typed values back so a rejection does not empty the form', async () => {
    const result = await createPropertyType(null, formOf({ ...TYPE_FORM, name: '' }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.values?.plural_name).toBe('Beach Properties')
    expect(result.values?.slug).toBe('beach-property')
  })

  it('turns a duplicate key into a message under the key field', async () => {
    mocked.reply.mockImplementation((call: MockCall) =>
      call.op === 'insert'
        ? {
            data: null,
            error: {
              code: '23505',
              message: 'duplicate key value violates unique constraint "property_types_slug_key"',
            },
          }
        : defaultReply(call)
    )

    const result = await createPropertyType(null, formOf(TYPE_FORM))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('conflict')
    expect(result.message).toBe(TYPE_SLUG_TAKEN)
    expect(result.fieldErrors?.slug).toBe(TYPE_SLUG_TAKEN)
    // The Postgres text names the index. It must not reach a screen.
    expect(JSON.stringify(result)).not.toContain('property_types_slug_key')
  })

  it('turns a duplicate name into a message under the name field', async () => {
    mocked.reply.mockImplementation((call: MockCall) =>
      call.op === 'insert'
        ? {
            data: null,
            error: { code: '23505', message: 'Key (name)=(Farm Land) already exists.' },
          }
        : defaultReply(call)
    )

    const result = await createPropertyType(null, formOf(TYPE_FORM))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fieldErrors?.name).toBe(TYPE_NAME_TAKEN)
  })

  it('turns a row-level-security refusal into the product denial, not a database message', async () => {
    mocked.reply.mockImplementation((call: MockCall) =>
      call.op === 'insert'
        ? { data: null, error: { code: '42501', message: 'new row violates row-level security' } }
        : defaultReply(call)
    )

    const result = await createPropertyType(null, formOf(TYPE_FORM))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('forbidden')
    expect(JSON.stringify(result)).not.toMatch(/row-level security/)
  })

  it('lets a fault through to the global handler rather than reporting a friendly lie', async () => {
    mocked.reply.mockImplementation((call: MockCall) =>
      call.op === 'insert'
        ? { data: null, error: { code: '08006', message: 'connection failure' } }
        : defaultReply(call)
    )

    await expect(createPropertyType(null, formOf(TYPE_FORM))).rejects.toBeDefined()
  })
})

describe('updatePropertyType', () => {
  it('updates the row it was given and nothing else', async () => {
    const result = await updatePropertyType(null, formOf({ ...TYPE_FORM, id: ROW_ID }))

    expect(result.ok).toBe(true)
    expect(writes()).toHaveLength(1)
    expect(writes()[0].op).toBe('update')
    expect(writes()[0].filters).toEqual({ id: ROW_ID })
  })

  /**
   * The property the public URLs depend on. `?cat=rlot` is in saved links and search
   * results; a rename that moved the key would break all of them silently. There is no
   * slug field on the schema, so there is nothing here to disable and nothing for a
   * hand-written POST to reach.
   */
  it('never writes the slug, even when the form posts one', async () => {
    await updatePropertyType(null, formOf({ ...TYPE_FORM, id: ROW_ID, slug: 'hijacked' }))

    expect(writes()[0].payload).not.toHaveProperty('slug')
    expect(JSON.stringify(writes()[0].payload)).not.toContain('hijacked')
  })

  it('never writes legacy_category either', async () => {
    await updatePropertyType(
      null,
      formOf({ ...TYPE_FORM, id: ROW_ID, legacy_category: 'farm_land' })
    )
    expect(writes()[0].payload).not.toHaveProperty('legacy_category')
  })

  it('reports a row that has gone as not_found, not as a success', async () => {
    mocked.reply.mockImplementation((call: MockCall) =>
      call.op === 'update' ? { data: [], error: null } : defaultReply(call)
    )

    const result = await updatePropertyType(null, formOf({ ...TYPE_FORM, id: ROW_ID }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('not_found')
  })

  it('refuses a malformed id before writing anything', async () => {
    const result = await updatePropertyType(null, formOf({ ...TYPE_FORM, id: 'nope' }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('validation')
    expect(mocked.calls).toHaveLength(0)
  })
})

describe('deletePropertyType — three refusals before the statement', () => {
  it('deletes a type nothing points at', async () => {
    const result = await deletePropertyType(null, formOf({ id: ROW_ID }))

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.message).toContain('Beach Property')
    expect(writes().map((call) => call.op)).toEqual(['delete'])
  })

  it('refuses while listings still use it, and issues no DELETE', async () => {
    usageCount = 4

    const result = await deletePropertyType(null, formOf({ id: ROW_ID }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('precondition')
    expect(result.message).toContain('4 listings')
    expect(writes()).toHaveLength(0)
  })

  /**
   * A seeded type with no listings on it is the case that LOOKS safe. Deleting it takes
   * the `legacy_category` mapping with it, and every listing the old encoding form writes
   * afterwards silently gets a NULL property_type_id.
   */
  it('refuses one of the five built-in types even when nothing points at it', async () => {
    rows.property_types = { id: ROW_ID, name: 'Farm Land', legacy_category: 'farm_land' }

    const result = await deletePropertyType(null, formOf({ id: ROW_ID }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('precondition')
    expect(result.message).toBe(BUILT_IN_TYPE_BLOCKED)
    expect(writes()).toHaveLength(0)
    // It refuses before it even asks how many listings there are.
    expect(mocked.calls.some((call) => call.options?.head)).toBe(false)
  })

  it('reports a row that has already gone as not_found', async () => {
    rows.property_types = null

    const result = await deletePropertyType(null, formOf({ id: ROW_ID }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('not_found')
    expect(writes()).toHaveLength(0)
  })

  it('turns the foreign key beating the count into a reload message, not a stack trace', async () => {
    mocked.reply.mockImplementation((call: MockCall) =>
      call.op === 'delete'
        ? { data: null, error: { code: '23503', message: 'violates foreign key constraint' } }
        : defaultReply(call)
    )

    const result = await deletePropertyType(null, formOf({ id: ROW_ID }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('precondition')
    expect(result.message).toMatch(/Reload the page/)
  })

  it('refuses a malformed id before reading anything', async () => {
    const result = await deletePropertyType(null, formOf({ id: 'nope' }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('validation')
    expect(mocked.calls).toHaveLength(0)
  })
})

// ===========================================================================
// Towns
// ===========================================================================

describe('createTown / updateTown / deleteTown', () => {
  it('inserts the three fields the add form owns', async () => {
    const result = await createTown(null, formOf(TOWN_FORM))

    expect(result.ok).toBe(true)
    expect(writes()[0].table).toBe('towns')
    expect(writes()[0].payload).toEqual({
      name: 'Polomolok',
      province: 'South Cotabato',
      slug: 'polomolok',
    })
  })

  it('does not let the add form set a status — a new town is active by default', async () => {
    await createTown(null, formOf({ ...TOWN_FORM, is_active: 'inactive' }))
    expect(writes()[0].payload).not.toHaveProperty('is_active')
  })

  it('lets the edit form archive a town, and still refuses to move its key', async () => {
    const result = await updateTown(
      null,
      formOf({ ...TOWN_FORM, id: ROW_ID, is_active: 'inactive', slug: 'hijacked' })
    )

    expect(result.ok).toBe(true)
    expect(writes()[0].payload).toEqual({
      name: 'Polomolok',
      province: 'South Cotabato',
      is_active: false,
    })
  })

  it('refuses a delete while listings still sit in the town, and issues no DELETE', async () => {
    usageCount = 1

    const result = await deleteTown(null, formOf({ id: ROW_ID }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('precondition')
    expect(result.message).toContain('1 listing still uses it')
    expect(writes()).toHaveLength(0)
  })

  it('counts against town_id, not against anything else', async () => {
    usageCount = 2
    await deleteTown(null, formOf({ id: ROW_ID }))

    const count = mocked.calls.find((call) => call.options?.head)
    expect(count?.table).toBe('listings')
    expect(count?.filters).toEqual({ town_id: ROW_ID })
  })

  it('deletes a town nothing points at', async () => {
    const result = await deleteTown(null, formOf({ id: ROW_ID }))
    expect(result.ok).toBe(true)
    expect(writes().map((call) => call.op)).toEqual(['delete'])
  })

  it('reports a town that has already gone as not_found', async () => {
    rows.towns = null
    const result = await deleteTown(null, formOf({ id: ROW_ID }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('not_found')
  })
})

// ===========================================================================
// Features
// ===========================================================================

describe('createFeature / updateFeature / deleteFeature', () => {
  it('inserts the four fields the add form owns', async () => {
    const result = await createFeature(null, formOf(FEATURE_FORM))

    expect(result.ok).toBe(true)
    expect(writes()[0].table).toBe('features')
    expect(writes()[0].payload).toEqual({
      name: 'Fenced',
      slug: 'fenced',
      sort_order: 40,
      is_active: true,
    })
  })

  /**
   * The rename this whole release exists to make safe. The name moves; the key does not,
   * which is why `?feat=` still finds the listings afterwards.
   */
  it('renames a feature without touching the key its public links use', async () => {
    const result = await updateFeature(
      null,
      formOf({ ...FEATURE_FORM, id: ROW_ID, name: 'Perimeter fenced', slug: 'perimeter-fenced' })
    )

    expect(result.ok).toBe(true)
    expect(writes()[0].payload).toEqual({
      name: 'Perimeter fenced',
      sort_order: 40,
      is_active: true,
    })
    expect(writes()[0].payload).not.toHaveProperty('slug')
  })

  it('refuses a delete while listings still carry it, and issues no DELETE', async () => {
    usageCount = 3

    const result = await deleteFeature(null, formOf({ id: ROW_ID }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('precondition')
    expect(result.message).toContain('3 listings')
    expect(result.message).toMatch(/Remove it from those listings first/)
    expect(writes()).toHaveLength(0)
  })

  it('counts the LINK table, which is where a feature is actually used', async () => {
    usageCount = 3
    await deleteFeature(null, formOf({ id: ROW_ID }))

    const count = mocked.calls.find((call) => call.options?.head)
    expect(count?.table).toBe('listing_features')
    expect(count?.filters).toEqual({ feature_id: ROW_ID })
  })

  it('deletes a feature nothing carries', async () => {
    const result = await deleteFeature(null, formOf({ id: ROW_ID }))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.message).toContain('Fenced')
  })

  it('turns the RESTRICT constraint firing into the reload sentence', async () => {
    mocked.reply.mockImplementation((call: MockCall) =>
      call.op === 'delete'
        ? {
            data: null,
            error: {
              code: '23503',
              message: 'update or delete on table "features" violates foreign key constraint',
            },
          }
        : defaultReply(call)
    )

    const result = await deleteFeature(null, formOf({ id: ROW_ID }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('precondition')
    expect(JSON.stringify(result)).not.toMatch(/foreign key constraint/)
  })

  it('turns a duplicate key on create into a message under the key field', async () => {
    mocked.reply.mockImplementation((call: MockCall) =>
      call.op === 'insert'
        ? {
            data: null,
            error: {
              code: '23505',
              message: 'duplicate key value violates unique constraint "features_slug_key"',
            },
          }
        : defaultReply(call)
    )

    const result = await createFeature(null, formOf(FEATURE_FORM))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fieldErrors?.slug).toBe(FEATURE_SLUG_TAKEN)
  })

  it('reports an edited feature that has gone as not_found', async () => {
    mocked.reply.mockImplementation((call: MockCall) =>
      call.op === 'update' ? { data: [], error: null } : defaultReply(call)
    )

    const result = await updateFeature(null, formOf({ ...FEATURE_FORM, id: ROW_ID }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('not_found')
  })
})
