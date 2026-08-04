import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { staffClient, staffUserId, anonClient, zzTitle, zzSlug } from './helpers'

/**
 * Listing encoding v2, apply 1 — the seed and the grants.
 *
 * ORIGINALLY covered the sync trigger too (`sync_listing_property_type()`, the two-way
 * `category` <-> `property_type_id` dual-write that let old and new code coexist during
 * the transition). Apply 3 (`20260804120000_listing_encoding_v2_apply3.sql`) dropped that
 * trigger, the function behind it, and the `category` column itself — the transition is
 * over, there is nothing left to dual-write, and a test that inserted `{ category: ... }`
 * now fails with "column does not exist" rather than proving anything. Those tests were
 * removed here rather than patched to "pass": the mechanism they proved is gone by design,
 * not broken. `list -> live` still cannot be reached directly — see
 * `publish-guard-trigger.integration.test.ts`, which already covers that independent of
 * category.
 *
 * What is still worth testing:
 *
 *   1. the seed, because the slugs ARE the public URL keys — get one wrong and every
 *      saved `?cat=` link dies silently;
 *   2. the grants, because `property_types` is a new table and this database's default
 *      privileges hand anon full DML on new tables automatically;
 *   3. the feature foreign key, which is a data-loss guard with no UI in front of it yet.
 */

// Every property type as web/lib/categories.ts renders it today. Nothing on screen may
// change on migration day, so the seed is asserted against the current UI verbatim.
const SEED = [
  { slug: 'rlot', name: 'Residential Lot', group_key: 'lots', legacy: 'residential_lot' },
  { slug: 'farm', name: 'Farm Land', group_key: null, legacy: 'farm_land' },
  { slug: 'clot', name: 'Commercial Lot', group_key: 'lots', legacy: 'commercial_lot' },
  { slug: 'rbdg', name: 'Residential Bldg', group_key: 'bldgs', legacy: 'residential_building' },
  { slug: 'cbdg', name: 'Commercial Bldg', group_key: 'bldgs', legacy: 'commercial_building' },
] as const

describe('listing encoding v2 apply 1: property_types, grants, feature FK', () => {
  let staff: SupabaseClient<Database>
  let staffId: string
  let anon: SupabaseClient<Database>
  let townId: string
  let propertyTypeId: string
  const createdListings: string[] = []
  let zzFeatureId: string | null = null
  let zzFeatureListingId: string | null = null

  beforeAll(async () => {
    staff = await staffClient()
    staffId = await staffUserId(staff)
    anon = anonClient()

    const { data: town, error } = await staff.from('towns').select('id').limit(1).single()
    if (error) throw error
    townId = town.id

    const { data: type, error: typeError } = await staff
      .from('property_types')
      .select('id')
      .eq('slug', 'rlot')
      .single()
    if (typeError) throw typeError
    propertyTypeId = type.id
  })

  afterAll(async () => {
    // The FK test attaches a feature to a listing; that link has to go before either row
    // can, now that the constraint is RESTRICT rather than CASCADE.
    if (zzFeatureListingId) {
      await staff.from('listing_features').delete().eq('listing_id', zzFeatureListingId)
    }
    for (const id of createdListings) {
      await staff.from('listings').delete().eq('id', id)
    }
    if (zzFeatureId) {
      await staff.from('features').delete().eq('id', zzFeatureId)
    }
  })

  type ListingInsert = Database['public']['Tables']['listings']['Insert']

  async function newListing(suffix: string, fields: Partial<ListingInsert> = {}) {
    const { data, error } = await staff
      .from('listings')
      .insert({
        title: zzTitle(`apply1 ${suffix}`),
        slug: zzSlug(`apply1-${suffix}`),
        price_php: 100000,
        town_id: townId,
        status: 'list',
        created_by: staffId,
        property_type_id: propertyTypeId,
        ...fields,
      })
      .select('id, property_type_id')
      .single()
    if (error) throw error
    createdListings.push(data.id)
    return data
  }

  // -- 1. the seed -----------------------------------------------------------

  it('seeds exactly the five current categories, keyed by the existing public URL keys', async () => {
    const { data, error } = await staff
      .from('property_types')
      .select('slug, name, group_key, legacy_category, is_active')
      .order('sort_order')
    expect(error).toBeNull()
    expect(data).toHaveLength(SEED.length)

    for (const [i, expected] of SEED.entries()) {
      expect(data![i].slug).toBe(expected.slug)
      expect(data![i].name).toBe(expected.name)
      expect(data![i].legacy_category).toBe(expected.legacy)
      expect(data![i].is_active).toBe(true)
    }
  })

  it('leaves Farm Land ungrouped, which is what the nav does today', async () => {
    // rlot/clot are "Lots" and rbdg/cbdg are "Buildings"; farm belongs to neither and
    // sits at the top level. A non-null group_key here would move it in the nav.
    const { data } = await staff.from('property_types').select('slug, group_key')
    const byKey = Object.fromEntries((data ?? []).map((r) => [r.slug, r.group_key]))
    expect(byKey.farm).toBeNull()
    expect(byKey.rlot).toBe('lots')
    expect(byKey.clot).toBe('lots')
    expect(byKey.rbdg).toBe('bldgs')
    expect(byKey.cbdg).toBe('bldgs')
  })

  // -- 2. the grants ---------------------------------------------------------

  it('lets anon read the presentation columns', async () => {
    const { data, error } = await anon
      .from('property_types')
      .select('id, slug, name, plural_name, icon, group_key, sort_order, is_active')
    expect(error).toBeNull()
    expect(data).toHaveLength(SEED.length)
  })

  it('lets anon read legacy_category — widened by 20260804110000 ahead of apply 3', async () => {
    // Originally refused: nothing public read this column before the ?cat= filter's join
    // needed it. 20260804110000_property_types_grant_anon_legacy_category.sql widened it,
    // deliberately ahead of the code that depends on it (D7's "widen before the code"
    // rule) — this asserts the grant that migration exists to add, not the refusal it
    // exists to remove.
    const { data, error } = await anon.from('property_types').select('legacy_category')
    expect(error).toBeNull()
    expect(data).toHaveLength(SEED.length)
  })

  it('does not let anon write property_types — the default-privilege trap', async () => {
    // A new table in this database inherits ALL privileges for anon from the schema's
    // default ACL. If the migration's `revoke all` were missing, this insert succeeds
    // and RLS is the only thing standing between the public and the category list.
    const { error } = await anon
      .from('property_types')
      .insert({ slug: 'zz-anon', name: 'zz anon', plural_name: 'zz anon' })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('lets anon read frontage on listings, and still refuses price_php', async () => {
    const { error: frontageError } = await anon.from('listings').select('frontage').limit(1)
    expect(frontageError).toBeNull()

    const { error: priceError } = await anon.from('listings').select('price_php').limit(1)
    expect(priceError).not.toBeNull()
    expect(priceError!.code).toBe('42501')
  })

  // -- 3. backfill, and property_type_id required ---------------------------

  it('leaves no listing without a property type', async () => {
    const { count, error } = await staff
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .is('property_type_id', null)
    expect(error).toBeNull()
    expect(count).toBe(0)
  })

  it('refuses to insert a listing with no property type', async () => {
    const { error } = await staff.from('listings').insert({
      title: zzTitle('apply1 no-type'),
      slug: zzSlug('apply1-no-type'),
      price_php: 100000,
      town_id: townId,
      status: 'list',
      created_by: staffId,
      // property_type_id omitted on purpose — NOT NULL since apply 3.
    } as ListingInsert)
    expect(error).not.toBeNull()
  })

  // -- 4. the feature foreign key -------------------------------------------

  it('refuses to delete a feature that listings still use', async () => {
    // Was ON DELETE CASCADE. Under CASCADE this delete succeeds and silently strips the
    // feature from every listing carrying it — no warning, no undo, no record. The
    // features CRUD screen in piece 2 is the thing that would have made that reachable,
    // which is why the constraint changes ahead of the screen.
    const { data: feature, error: featureError } = await staff
      .from('features')
      .insert({ name: zzTitle('apply1 feature'), slug: zzSlug('apply1-feature') })
      .select('id')
      .single()
    if (featureError) throw featureError
    zzFeatureId = feature.id

    const listing = await newListing('feature-fk')
    zzFeatureListingId = listing.id

    const { error: linkError } = await staff
      .from('listing_features')
      .insert({ listing_id: listing.id, feature_id: feature.id })
    expect(linkError).toBeNull()

    const { error: deleteError } = await staff.from('features').delete().eq('id', feature.id)
    expect(deleteError).not.toBeNull()
    expect(deleteError!.code).toBe('23503')
  })
})
