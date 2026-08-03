import { describe, it, expect } from 'vitest'
import { labelFromDb, keyFromDb, dbCategoriesFor, CATEGORY_GROUPS } from '@/lib/categories'

/**
 * The null branch of labelFromDb is the whole reason this file exists.
 *
 * Apply 1b of listing encoding v2 made `listings.category` nullable so the owner can add a
 * sixth property type without waiting for apply 3. A null reaches labelFromDb through
 * lib/admin/queries.ts on the admin listings index and the listing detail page — neither
 * guards it. Before this change the lookup was `CATEGORIES[BY_DB[db]].label`, so a null
 * threw "Cannot read properties of undefined" and took the admin index down the first time
 * a new property type was used. TypeScript did not catch it: those rows are typed locally,
 * not from the generated Database Row.
 */
describe('labelFromDb', () => {
  it('labels a stored category the way the screen does today', () => {
    expect(labelFromDb('residential_lot')).toBe('Residential Lot')
    expect(labelFromDb('residential_building')).toBe('Residential Bldg')
  })

  it('returns a placeholder instead of throwing when the category is null', () => {
    expect(() => labelFromDb(null)).not.toThrow()
    expect(labelFromDb(null)).toBe('Other type')
  })
})

/**
 * The seed in the apply-1 migration reproduces this map into the property_types table, and
 * the slugs are the public URL keys. If either drifts, saved `?cat=` links break silently —
 * these assertions are what make that drift loud.
 */
describe('category keys and groups', () => {
  it('maps every enum value back to its short URL key', () => {
    expect(keyFromDb('residential_lot')).toBe('rlot')
    expect(keyFromDb('farm_land')).toBe('farm')
    expect(keyFromDb('commercial_lot')).toBe('clot')
    expect(keyFromDb('residential_building')).toBe('rbdg')
    expect(keyFromDb('commercial_building')).toBe('cbdg')
  })

  it('keeps Farm Land out of both nav groups', () => {
    // property_types.group_key seeds NULL for farm precisely because of this.
    const grouped = [...CATEGORY_GROUPS.lots, ...CATEGORY_GROUPS.bldgs]
    expect(grouped).not.toContain('farm')
  })

  it('expands a group key to every enum value it covers', () => {
    expect(dbCategoriesFor('lots')).toEqual(['residential_lot', 'commercial_lot'])
    expect(dbCategoriesFor('rlot')).toEqual(['residential_lot'])
    expect(dbCategoriesFor('nonsense')).toBeNull()
  })
})
