import * as z from 'zod'
import { blankToNull } from '@/lib/admin/action-result'

/**
 * The lookup lists behind every listing: property types, towns and features.
 *
 * Everything in this file is a pure function of its arguments — the schemas the three
 * forms are validated against, the option lists the selects render, and the sentences a
 * refusal is reported with. It lives in `lib/` for the reason
 * `lib/admin/property-no.ts` records: `'use server'` refuses to export a non-async
 * function, so a schema declared inside `app/admin/settings-actions.ts` could never be
 * unit-tested and could never be shared with the client component that renders the form.
 * Nothing here opens a Supabase client or reads a session.
 *
 * THREE RULES ARE ENCODED HERE RATHER THAN LEFT TO THE FORM, because a form is only a
 * suggestion and these are the ones that break something silently when they are wrong:
 *
 * 1. A SLUG IS SET ONCE AND NEVER EDITED. `property_types.slug` is the public category
 *    key (`?cat=beach-property`) and `features.slug` is the public feature key
 *    (`?feat=titled`) — both land in saved links, bookmarks and search results, so
 *    changing one silently breaks every link that already points at it. The update
 *    schemas therefore have NO slug field at all; it is not merely disabled in the UI,
 *    there is nothing for a hand-written POST to set. `towns.slug` is not a URL key today
 *    and is held to the same rule for one reason: it is the only stable handle a town has
 *    once its name has been corrected.
 * 2. AN ICON IS A SPRITE ID, NOT FREE TEXT. `components/Icon.tsx` renders
 *    `<use href="#i-{icon}">` against the sprite defined once in the layout. A name the
 *    sprite does not carry renders as nothing at all — an invisible defect — so the field
 *    is an enum of ids the sprite really has, not a text box.
 * 3. `legacy_category` IS NOT A FORM FIELD. It is transition scaffolding that maps the
 *    five seeded types back to the `listing_category` enum and is dropped in apply 3. A
 *    type created here must leave it NULL, so it appears in no schema and in no payload.
 */

/**
 * The sprite ids that make sense on a property type, out of the 27 the sprite carries.
 *
 * The first five are the ones the seeded types already use, so this list can never
 * invalidate an existing row. The rest are the shapes a sixth type might plausibly want.
 * `facebook`, `mail`, `phone`, `x` and friends are deliberately absent: they exist for the
 * footer and the dialogs, and offering them here would only produce odd-looking rows.
 */
export const PROPERTY_TYPE_ICONS = [
  'pin',
  'tag',
  'area',
  'home',
  'key',
  'star',
  'shield',
  'target',
  'award',
  'hand',
] as const

export type PropertyTypeIcon = (typeof PROPERTY_TYPE_ICONS)[number]

/**
 * The nav groups, as VALUES the database stores against LABELS a person reads.
 *
 * The stored values are `lots` / `bldgs` / NULL — never the words "Lots" and "Buildings".
 * Getting that backwards is the failure mode this constant exists to prevent: the browse
 * nav groups on the stored key, so a row carrying the display word would quietly fall out
 * of its group and render as its own top-level item.
 *
 * The empty string is the form's spelling of NULL, because an HTML option value cannot be
 * null. It is turned back into NULL in the schema below.
 */
export const NAV_GROUPS = [
  { value: '', label: 'Ungrouped' },
  { value: 'lots', label: 'Lots' },
  { value: 'bldgs', label: 'Buildings' },
] as const

/** What a row's group reads as. An unknown key renders as itself rather than as a blank. */
export function navGroupLabel(groupKey: string | null): string {
  if (!groupKey) return 'Ungrouped'
  return NAV_GROUPS.find((group) => group.value === groupKey)?.label ?? groupKey
}

/**
 * The slug rule. Lowercase letters, digits and single interior hyphens — the same pattern
 * `app/admin/actions.ts` holds listing slugs to, and stricter than the database's own
 * `^[a-z0-9-]+$` check, which would accept `-farm-` and `--`.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const SLUG_ERROR =
  'The key may only use lowercase letters, numbers and single hyphens — for example beach-property.'

function slugField(max: number) {
  return z
    .string({ error: 'Give it a key for the web address.' })
    .trim()
    .toLowerCase()
    .min(2, { error: 'The key needs at least 2 characters.' })
    .max(max, { error: `Keep the key under ${max} characters.` })
    .regex(SLUG_PATTERN, { error: SLUG_ERROR })
}

/**
 * Active / Inactive as a required choice rather than a checkbox.
 *
 * A checkbox posts nothing when it is unticked, so a missing field and "the clerk turned
 * this off" would be the same submission — and a dropped field would silently archive a
 * row. An enum with no default refuses the submission instead.
 */
const StatusField = z
  .enum(['active', 'inactive'], { error: 'Choose Active or Inactive.' })
  .transform((value) => value === 'active')

function nameField(max: number, error: string) {
  return z
    .string({ error })
    .trim()
    .min(2, { error: 'That name is too short.' })
    .max(max, { error: `Keep the name under ${max} characters.` })
}

const SortOrderField = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? 100 : value),
  z.coerce
    .number({ error: 'The list position must be a whole number.' })
    .int({ error: 'The list position must be a whole number.' })
    .min(0, { error: 'The list position cannot be negative.' })
    // smallint, and a number nobody needs to exceed: the seeds are 10 apart.
    .max(999, { error: 'Keep the list position under 1000.' })
)

const IconField = z.enum(PROPERTY_TYPE_ICONS, {
  error: 'Choose one of the icons in the list.',
})

const GroupKeyField = z.preprocess(
  blankToNull,
  z.enum(['lots', 'bldgs'], { error: 'Choose a nav group from the list.' }).nullable()
)

// ---------------------------------------------------------------------------
// Property types
// ---------------------------------------------------------------------------

const propertyTypeShape = {
  name: nameField(60, 'Give the property type a name.'),
  plural_name: z
    .string({ error: 'Give the plural form — it heads the browse pages.' })
    .trim()
    .min(2, { error: 'That plural name is too short.' })
    .max(80, { error: 'Keep the plural name under 80 characters.' }),
  icon: IconField,
  group_key: GroupKeyField,
  sort_order: SortOrderField,
  is_active: StatusField,
}

export const CreatePropertyTypeSchema = z.object({
  ...propertyTypeShape,
  slug: slugField(40),
})

/** No `slug`. See rule 1 at the top of this file. */
export const UpdatePropertyTypeSchema = z.object({
  ...propertyTypeShape,
  id: z.uuid({ error: 'That property type could not be identified.' }),
})

export const PropertyTypeRefSchema = z.object({
  id: z.uuid({ error: 'That property type could not be identified.' }),
})

// ---------------------------------------------------------------------------
// Towns
// ---------------------------------------------------------------------------

const townShape = {
  name: nameField(80, 'Give the town a name.'),
  province: z
    .string({ error: 'Give the province.' })
    .trim()
    .min(2, { error: 'That province name is too short.' })
    .max(80, { error: 'Keep the province under 80 characters.' }),
}

/**
 * No status on the create form: a town is added because it is wanted, and the column
 * defaults to active. The edit form carries it, which is how a town is retired.
 */
export const CreateTownSchema = z.object({
  ...townShape,
  slug: slugField(60),
})

export const UpdateTownSchema = z.object({
  ...townShape,
  id: z.uuid({ error: 'That town could not be identified.' }),
  is_active: StatusField,
})

export const TownRefSchema = z.object({
  id: z.uuid({ error: 'That town could not be identified.' }),
})

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

const featureShape = {
  name: nameField(60, 'Give the feature a name.'),
  sort_order: SortOrderField,
  is_active: StatusField,
}

export const CreateFeatureSchema = z.object({
  ...featureShape,
  slug: slugField(60),
})

export const UpdateFeatureSchema = z.object({
  ...featureShape,
  id: z.uuid({ error: 'That feature could not be identified.' }),
})

export const FeatureRefSchema = z.object({
  id: z.uuid({ error: 'That feature could not be identified.' }),
})

// ---------------------------------------------------------------------------
// The sentences
// ---------------------------------------------------------------------------

/** "1 listing" / "4 listings", so no message has to say "1 listings". */
export function listingCountLabel(count: number): string {
  return `${count} listing${count === 1 ? '' : 's'}`
}

/**
 * Why a delete was refused, naming the row and the number of listings holding it.
 *
 * The count is the point. "Cannot delete" tells somebody nothing they can act on;
 * "4 listings still carry it" tells them exactly how much work standing between them and
 * the delete they wanted, and the same sentence is what the database would have refused
 * with as a bare 23503.
 */
export function inUseMessage(kind: 'property type' | 'town' | 'feature', name: string, count: number): string {
  return `Deleting “${name}” is blocked — ${listingCountLabel(count)} still ${
    count === 1 ? 'uses' : 'use'
  } it. ${
    kind === 'feature'
      ? 'Remove it from those listings first.'
      : `Move those listings to another ${kind} first.`
  }`
}

/** The short form for a disabled button's tooltip. */
export const IN_USE_TOOLTIP = 'In use'

/**
 * The database refused the delete after the screen had cleared it.
 *
 * Not the same sentence as `inUseMessage`, on purpose: this one only happens when
 * somebody attached the row to a listing between the page render and the click, and
 * "reload" is the action that resolves it. Saying "N listings use it" here would quote a
 * count that was already out of date when it was read.
 */
export function deleteRaceMessage(name: string): string {
  return `“${name}” was put to use while this page was open, so nothing was deleted. Reload the page to see where it stands.`
}

/**
 * The five seeded property types cannot be deleted, and this is why.
 *
 * Each of them carries a `legacy_category` — the join key that maps it back to the
 * `listing_category` enum — and the `sync_listing_property_type` trigger uses that mapping
 * to fill `property_type_id` on every listing the OLD encoding form writes. Delete the row
 * and that lookup returns nothing: listings created afterwards get a NULL
 * `property_type_id`, silently, and apply 3's NOT NULL then has nothing to stand on. A
 * seeded type with no listings on it today would still be deletable without this guard,
 * which is exactly the case that looks harmless and is not.
 */
export const BUILT_IN_TYPE_BLOCKED =
  'This is one of the five built-in property types and cannot be deleted — listings encoded on the old form still map through it. Set it to Inactive instead, which takes it out of the list without breaking anything.'

export const TYPE_NAME_TAKEN = 'Another property type already uses that name.'
export const TYPE_SLUG_TAKEN = 'Another property type already uses that key.'
export const TOWN_NAME_TAKEN = 'That town and province are already in the list.'
export const TOWN_SLUG_TAKEN = 'Another town already uses that key.'
export const FEATURE_NAME_TAKEN = 'Another feature already uses that name.'
export const FEATURE_SLUG_TAKEN = 'Another feature already uses that key.'

/**
 * Which unique index a 23505 came from, read from the Postgres message.
 *
 * The same deliberate exception `lib/admin/property-no.ts` documents: these tables carry
 * more than one unique constraint, they all raise 23505, and the code alone cannot say
 * which. The message is read here to ROUTE the failure and never leaves this module —
 * what the clerk sees is one of the fixed sentences above, naming no table and no index.
 *
 * `details` is checked as well as `message` because PostgREST puts the constraint name in
 * one and `Key (slug)=(…) already exists` in the other, and which of the two arrives has
 * changed between PostgREST versions.
 */
export function conflictField(
  error: { message?: string | null; details?: string | null } | null | undefined
): 'slug' | 'name' | null {
  if (!error) return null
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  if (text.includes('slug')) return 'slug'
  if (text.includes('name')) return 'name'
  return null
}
