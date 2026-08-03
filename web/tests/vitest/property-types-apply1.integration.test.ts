import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { staffClient, staffUserId, anonClient, zzTitle, zzSlug } from './helpers'

/**
 * Listing encoding v2, apply 1 — the schema half.
 *
 * THESE TESTS FAIL UNTIL `20260803090000_listing_encoding_v2_apply1.sql` IS APPLIED.
 * That is intentional and is why the file lands in the same commit as the migration:
 * there is no local Postgres on this machine and no staging, so production is the only
 * place the migration can be proved, and the suite is the proof.
 *
 * What is worth testing here is narrow and specific. Column defaults and NOT NULLs are
 * Postgres doing its job. The four things that can actually be wrong are:
 *
 *   1. the seed, because the slugs ARE the public URL keys — get one wrong and every
 *      saved `?cat=` link dies silently;
 *   2. the grants, because `property_types` is a new table and this database's default
 *      privileges hand anon full DML on new tables automatically;
 *   3. the sync trigger, which is the only thing keeping two generations of code writing
 *      complete rows during the transition;
 *   4. the feature foreign key, which is a data-loss guard with no UI in front of it yet.
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

describe('listing encoding v2 apply 1: property_types, grants, sync trigger, feature FK', () => {
  let staff: SupabaseClient<Database>
  let staffId: string
  let anon: SupabaseClient<Database>
  let townId: string
  const createdListings: string[] = []
  let zzFeatureId: string | null = null
  let zzFeatureListingId: string | null = null
  let zzTypeId: string | null = null

  beforeAll(async () => {
    staff = await staffClient()
    staffId = await staffUserId(staff)
    anon = anonClient()

    const { data: town, error } = await staff.from('towns').select('id').limit(1).single()
    if (error) throw error
    townId = town.id
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
    // Last: the FK from listings is RESTRICT, so every listing using this type is gone by now.
    if (zzTypeId) {
      await staff.from('property_types').delete().eq('id', zzTypeId)
    }
  })

  type ListingInsert = Database['public']['Tables']['listings']['Insert']

  async function newListing(suffix: string, fields: Partial<ListingInsert> = {}) {
    const { data, error } = await staff
      .from('listings')
      // The cast is the point of the trigger, not a workaround for it. `category` is
      // NOT NULL until apply 3, so the generated Insert type marks it required — but
      // one of the tests below deliberately omits it to prove the trigger fills it
      // from property_type_id. The type is stricter than the database now is.
      .insert({
        title: zzTitle(`apply1 ${suffix}`),
        slug: zzSlug(`apply1-${suffix}`),
        price_php: 100000,
        town_id: townId,
        status: 'list',
        created_by: staffId,
        ...fields,
      } as ListingInsert)
      .select('id, category, property_type_id')
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

  it('does not let anon read legacy_category, the transition scaffolding', async () => {
    const { error } = await anon.from('property_types').select('legacy_category')
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
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

  // -- 3. the backfill and the sync trigger ----------------------------------

  it('leaves no listing without a property type', async () => {
    const { count, error } = await staff
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .is('property_type_id', null)
    expect(error).toBeNull()
    expect(count).toBe(0)
  })

  it('fills property_type_id when only the old category column is written', async () => {
    // This is what a deployment running the OLD code does on every insert.
    const row = await newListing('old-code', { category: 'farm_land' })
    expect(row.property_type_id).not.toBeNull()

    const { data: type } = await staff
      .from('property_types')
      .select('slug')
      .eq('id', row.property_type_id!)
      .single()
    expect(type!.slug).toBe('farm')
  })

  it('fills category when only the new property_type_id column is written', async () => {
    // ...and this is what the NEW code will do, before apply 3 drops category.
    const { data: type } = await staff
      .from('property_types')
      .select('id')
      .eq('slug', 'clot')
      .single()

    const row = await newListing('new-code', { property_type_id: type!.id })
    expect(row.category).toBe('commercial_lot')
  })

  it('re-derives category when the property type is CHANGED on an existing listing', async () => {
    // The regression this file exists for. Deriving only when one side is NULL looks
    // right and is wrong: on an UPDATE the untouched column holds its previous value,
    // never NULL, so a type change would leave `category` stale — and the public site
    // reads `category` until apply 3, so the listing would keep showing its old type.
    const row = await newListing('retype', { category: 'residential_lot' })

    const { data: rbdg } = await staff
      .from('property_types')
      .select('id')
      .eq('slug', 'rbdg')
      .single()

    const { error } = await staff
      .from('listings')
      .update({ property_type_id: rbdg!.id })
      .eq('id', row.id)
    expect(error).toBeNull()

    const { data: after } = await staff
      .from('listings')
      .select('category, property_type_id')
      .eq('id', row.id)
      .single()
    expect(after!.category).toBe('residential_building')
    expect(after!.property_type_id).toBe(rbdg!.id)
  })

  // -- 3b. apply 1b: a sixth property type is usable before apply 3 ----------

  it('lets a NEW property type be created and used on a draft, leaving category null', async () => {
    // Apply 1 left listings.category NOT NULL, so a type with no legacy_category could not
    // be assigned to anything until apply 3. Apply 1b relaxed that. This is the whole point
    // of that migration: the owner can add a type today and encode against it.
    const { data: type, error: typeError } = await staff
      .from('property_types')
      .insert({
        slug: zzSlug('apply1b-type').toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        name: zzTitle('apply1b type'),
        plural_name: zzTitle('apply1b types'),
        sort_order: 900,
      })
      .select('id, legacy_category')
      .single()
    if (typeError) throw typeError
    zzTypeId = type.id

    // No enum value to map to — that is what makes the null legitimate rather than a bug.
    expect(type.legacy_category).toBeNull()

    const row = await newListing('sixth-type', { property_type_id: type.id })
    expect(row.property_type_id).toBe(type.id)
    expect(row.category).toBeNull()
  })

  it('refuses to publish a listing that has no category', async () => {
    // The listing above cannot reach a public status. Two independent things enforce that —
    // guard_listing_publish (which since apply 2 refuses `list -> live` outright, as it is
    // not an edge in the lifecycle graph) and the listings_category_required_when_public
    // CHECK — and the test asserts the outcome rather than which one fired, because either
    // is correct.
    const { data: listing } = await staff
      .from('listings')
      .select('id')
      .eq('property_type_id', zzTypeId!)
      .single()

    const { error } = await staff
      .from('listings')
      .update({ status: 'live' })
      .eq('id', listing!.id)
    expect(error).not.toBeNull()

    const { data: after } = await staff
      .from('listings')
      .select('status')
      .eq('id', listing!.id)
      .single()
    expect(after!.status).toBe('list')
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

    const listing = await newListing('feature-fk', { category: 'residential_lot' })
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
