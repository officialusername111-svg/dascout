import type { Database } from '@/lib/database.types'

export type DbCategory = Database['public']['Enums']['listing_category']

/**
 * The short keys are the ones the static mockup put in URLs (`?cat=rlot`), kept so
 * existing links and bookmarks keep working. Everything else in the app talks in
 * Postgres enum values.
 */
export const CATEGORIES = {
  rlot: {
    db: 'residential_lot',
    label: 'Residential Lot',
    plural: 'Residential Lots',
    icon: 'pin',
  },
  farm: {
    db: 'farm_land',
    label: 'Farm Land',
    plural: 'Farm Land',
    icon: 'tag',
  },
  clot: {
    db: 'commercial_lot',
    label: 'Commercial Lot',
    plural: 'Commercial Lots',
    icon: 'area',
  },
  rbdg: {
    db: 'residential_building',
    label: 'Residential Bldg',
    plural: 'Residential Buildings',
    icon: 'home',
  },
  cbdg: {
    db: 'commercial_building',
    label: 'Commercial Bldg',
    plural: 'Commercial Buildings',
    icon: 'key',
  },
} as const satisfies Record<string, { db: DbCategory; label: string; plural: string; icon: string }>

export type CategoryKey = keyof typeof CATEGORIES

/** Nav shortcuts that stand for more than one category. */
export const CATEGORY_GROUPS = {
  lots: ['rlot', 'clot'],
  bldgs: ['rbdg', 'cbdg'],
} as const satisfies Record<string, readonly CategoryKey[]>

export type CategoryGroupKey = keyof typeof CATEGORY_GROUPS

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[]

const BY_DB = Object.fromEntries(
  CATEGORY_KEYS.map((key) => [CATEGORIES[key].db, key])
) as Record<DbCategory, CategoryKey>

export function keyFromDb(db: DbCategory): CategoryKey {
  return BY_DB[db]
}

/**
 * `db` is null whenever a listing's property type has no `legacy_category` mapping — every
 * type added through the Settings screen, since apply 1. Before apply 3 of listing encoding
 * v2 this was blocked by a NOT NULL + CHECK constraint on `listings.category`; apply 3
 * dropped both along with the column, so an unmapped type on a `live` listing is now a real,
 * reachable case on the public site too, not just an admin-draft edge case. This returns a
 * neutral placeholder rather than throwing, which is what an unguarded
 * `CATEGORIES[BY_DB[null]].label` would do the first time one is used.
 */
export function labelFromDb(db: DbCategory | null): string {
  return db ? CATEGORIES[BY_DB[db]].label : 'Other type'
}

export function isCategoryKey(value: string): value is CategoryKey {
  return value in CATEGORIES
}

export function isCategoryGroupKey(value: string): value is CategoryGroupKey {
  return value in CATEGORY_GROUPS
}

/** Every enum value a `?cat=` parameter selects — one key, a group, or nothing. */
export function dbCategoriesFor(cat: string | undefined): DbCategory[] | null {
  if (!cat) return null
  if (isCategoryGroupKey(cat)) return CATEGORY_GROUPS[cat].map((k) => CATEGORIES[k].db)
  if (isCategoryKey(cat)) return [CATEGORIES[cat].db]
  return null
}

/** How a chosen category reads inside the "12 properties · …" status line. */
export function describeCategory(cat: string): string | null {
  if (isCategoryGroupKey(cat)) return cat === 'lots' ? 'lots' : 'buildings'
  if (isCategoryKey(cat)) return CATEGORIES[cat].label
  return null
}
