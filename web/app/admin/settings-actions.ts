'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getStaffUser } from '@/lib/admin/auth'
import {
  FK_VIOLATION,
  RLS_DENIED,
  UNIQUE_VIOLATION,
  denied,
  invalid,
  submittedValues,
  type ActionResult,
} from '@/lib/admin/action-result'
import {
  BUILT_IN_TYPE_BLOCKED,
  CreateFeatureSchema,
  CreatePropertyTypeSchema,
  CreateTownSchema,
  FEATURE_NAME_TAKEN,
  FEATURE_SLUG_TAKEN,
  FeatureRefSchema,
  PropertyTypeRefSchema,
  TOWN_NAME_TAKEN,
  TOWN_SLUG_TAKEN,
  TYPE_NAME_TAKEN,
  TYPE_SLUG_TAKEN,
  TownRefSchema,
  UpdateFeatureSchema,
  UpdatePropertyTypeSchema,
  UpdateTownSchema,
  conflictField,
  deleteRaceMessage,
  inUseMessage,
} from '@/lib/admin/settings'

/**
 * The nine writes behind /admin/settings: create, edit and delete for property types,
 * towns and features.
 *
 * They live in their own file rather than in `app/admin/actions.ts` because that one is
 * already 1300 lines and covers a different subject — listings and their lifecycle. Every
 * rule it states still holds here and is not restated per action:
 *
 * 1. The first two lines re-check that the caller is staff. A server action is a public
 *    POST endpoint whichever page happens to render its form, so rendering the form behind
 *    a guarded layout proves nothing about who sent the request. It is not the security
 *    boundary either — `*_staff_write` row-level policies ask `is_staff()` in the database
 *    and answer 42501 to anybody else, which is what holds against a hand-written POST.
 * 2. Nothing the browser sends is trusted beyond the fields the schema names. `slug` is
 *    absent from all three update schemas, `legacy_category` is absent from all six write
 *    schemas, and neither can be reached by adding a field to the form.
 * 3. Anything a person can fix comes back as a value the form renders. A database that is
 *    not answering is left to throw, so the error page and the logs both see it.
 *
 * WHY EVERY DELETE ASKS TWICE. The screen disables a delete whose row is in use, and each
 * delete action counts the references again before issuing the statement, and the foreign
 * key is ON DELETE RESTRICT underneath. That is three layers for one rule, and none of them
 * is redundant: the disabled button is what a person reads, the count is what makes the
 * refusal a sentence instead of a SQLSTATE, and the constraint is the only one of the three
 * that still holds for a caller who never loaded the page.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Where a change to these lists shows up.
 *
 * `/admin/settings` is obvious. `/` is here because the home page's sidebar renders the
 * feature chips from `getPopularFeatures()`, so a renamed feature would otherwise keep its
 * old label there until the page's own cache turned over. The property pages read the same
 * list and are left to their own revalidation: they are per-slug routes, and sweeping every
 * one of them on a settings edit would be a large cache invalidation for a chip.
 */
function revalidateSettings(): void {
  revalidatePath('/admin/settings')
  revalidatePath('/')
}

/** How many listings point at one property type or one town, in every status. */
async function countListingsBy(
  supabase: SupabaseServerClient,
  column: 'property_type_id' | 'town_id',
  id: string
): Promise<number> {
  const { count, error } = await supabase
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq(column, id)

  if (error) throw error
  return count ?? 0
}

/** How many listings carry one feature. */
async function countFeatureLinks(supabase: SupabaseServerClient, id: string): Promise<number> {
  const { count, error } = await supabase
    .from('listing_features')
    .select('feature_id', { count: 'exact', head: true })
    .eq('feature_id', id)

  if (error) throw error
  return count ?? 0
}

/**
 * A unique violation, turned into a message under the field that caused it.
 *
 * Which field is worked out from the Postgres message by `conflictField`; when it cannot
 * tell, the message becomes a form-level banner rather than being pinned to a guess. A
 * wrong field marker is worse than none — it sends the clerk to edit the value that was
 * fine.
 */
function conflictResult(
  error: { message?: string | null; details?: string | null },
  messages: { slug: string; name: string },
  values: Record<string, string>
): ActionResult {
  const field = conflictField(error)
  if (!field) {
    return {
      ok: false,
      code: 'conflict',
      message: 'Something in that entry is already in the list.',
      values,
    }
  }
  return {
    ok: false,
    code: 'conflict',
    message: messages[field],
    fieldErrors: { [field]: messages[field] },
    values,
  }
}

// ---------------------------------------------------------------------------
// Property types
// ---------------------------------------------------------------------------

function propertyTypeFieldsFrom(formData: FormData) {
  return {
    name: formData.get('name'),
    plural_name: formData.get('plural_name'),
    icon: formData.get('icon'),
    group_key: formData.get('group_key'),
    sort_order: formData.get('sort_order'),
    is_active: formData.get('is_active'),
  }
}

/**
 * Adds a property type.
 *
 * `legacy_category` is never written. It is the transition join key back to the
 * `listing_category` enum, it belongs to the five seeded rows only, and apply 3 drops it —
 * a type created here has no enum counterpart and must say so by leaving the column NULL.
 * `20260803100000_listing_category_nullable.sql` is what makes such a type usable on a
 * listing before apply 3.
 */
export async function createPropertyType(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const raw = { ...propertyTypeFieldsFrom(formData), slug: formData.get('slug') }
  const parsed = CreatePropertyTypeSchema.safeParse(raw)
  if (!parsed.success) return invalid(parsed.error, submittedValues(raw))

  const supabase = await createClient()
  const { error } = await supabase.from('property_types').insert(parsed.data).select('id').single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return conflictResult(
        error,
        { slug: TYPE_SLUG_TAKEN, name: TYPE_NAME_TAKEN },
        submittedValues(raw)
      )
    }
    if (error.code === RLS_DENIED) return denied()
    throw error
  }

  revalidateSettings()
  return { ok: true, message: `Added “${parsed.data.name}”.` }
}

/**
 * Edits a property type — everything except its key.
 *
 * The slug is not in the schema at all, so there is nothing here to guard: a form that
 * posted one would have it ignored, and the update payload below is built from the parsed
 * fields rather than from the submission.
 */
export async function updatePropertyType(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const raw = propertyTypeFieldsFrom(formData)
  const parsed = UpdatePropertyTypeSchema.safeParse({ ...raw, id: formData.get('id') })
  if (!parsed.success) return invalid(parsed.error, submittedValues(raw))

  const { id, ...fields } = parsed.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('property_types')
    .update(fields)
    .eq('id', id)
    .select('id')

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return conflictResult(
        error,
        { slug: TYPE_SLUG_TAKEN, name: TYPE_NAME_TAKEN },
        submittedValues(raw)
      )
    }
    if (error.code === RLS_DENIED) return denied()
    throw error
  }

  if (!data.length) {
    return { ok: false, code: 'not_found', message: 'That property type no longer exists.' }
  }

  revalidateSettings()
  return { ok: true, message: `Saved “${fields.name}”.` }
}

/**
 * Deletes a property type, if nothing points at it and it is not one of the seeded five.
 *
 * The built-in check comes BEFORE the count, because a seeded type with no listings on it
 * is the case that looks safe and is not — see BUILT_IN_TYPE_BLOCKED.
 */
export async function deletePropertyType(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const parsed = PropertyTypeRefSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return invalid(parsed.error)

  const { id } = parsed.data
  const supabase = await createClient()

  const { data: row, error: readError } = await supabase
    .from('property_types')
    .select('id, name, legacy_category')
    .eq('id', id)
    .maybeSingle()

  if (readError) throw readError
  if (!row) return { ok: false, code: 'not_found', message: 'That property type no longer exists.' }

  if (row.legacy_category !== null) {
    return { ok: false, code: 'precondition', message: BUILT_IN_TYPE_BLOCKED }
  }

  const count = await countListingsBy(supabase, 'property_type_id', id)
  if (count > 0) {
    return {
      ok: false,
      code: 'precondition',
      message: inUseMessage('property type', row.name, count),
    }
  }

  const { data: deleted, error } = await supabase
    .from('property_types')
    .delete()
    .eq('id', id)
    .select('id')

  if (error) {
    // The constraint beat the count: a listing was assigned this type between the two.
    if (error.code === FK_VIOLATION) {
      return { ok: false, code: 'precondition', message: deleteRaceMessage(row.name) }
    }
    if (error.code === RLS_DENIED) return denied()
    throw error
  }

  if (!deleted.length) {
    return { ok: false, code: 'not_found', message: 'That property type no longer exists.' }
  }

  revalidateSettings()
  return { ok: true, message: `Deleted “${row.name}”.` }
}

// ---------------------------------------------------------------------------
// Towns
// ---------------------------------------------------------------------------

function townFieldsFrom(formData: FormData) {
  return {
    name: formData.get('name'),
    province: formData.get('province'),
  }
}

export async function createTown(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const raw = { ...townFieldsFrom(formData), slug: formData.get('slug') }
  const parsed = CreateTownSchema.safeParse(raw)
  if (!parsed.success) return invalid(parsed.error, submittedValues(raw))

  const supabase = await createClient()
  const { error } = await supabase.from('towns').insert(parsed.data).select('id').single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return conflictResult(
        error,
        { slug: TOWN_SLUG_TAKEN, name: TOWN_NAME_TAKEN },
        submittedValues(raw)
      )
    }
    if (error.code === RLS_DENIED) return denied()
    throw error
  }

  revalidateSettings()
  return { ok: true, message: `Added “${parsed.data.name}”.` }
}

export async function updateTown(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const raw = { ...townFieldsFrom(formData), is_active: formData.get('is_active') }
  const parsed = UpdateTownSchema.safeParse({ ...raw, id: formData.get('id') })
  if (!parsed.success) return invalid(parsed.error, submittedValues(raw))

  const { id, ...fields } = parsed.data
  const supabase = await createClient()

  const { data, error } = await supabase.from('towns').update(fields).eq('id', id).select('id')

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return conflictResult(
        error,
        { slug: TOWN_SLUG_TAKEN, name: TOWN_NAME_TAKEN },
        submittedValues(raw)
      )
    }
    if (error.code === RLS_DENIED) return denied()
    throw error
  }

  if (!data.length) {
    return { ok: false, code: 'not_found', message: 'That town no longer exists.' }
  }

  revalidateSettings()
  return { ok: true, message: `Saved “${fields.name}”.` }
}

export async function deleteTown(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const parsed = TownRefSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return invalid(parsed.error)

  const { id } = parsed.data
  const supabase = await createClient()

  const { data: row, error: readError } = await supabase
    .from('towns')
    .select('id, name')
    .eq('id', id)
    .maybeSingle()

  if (readError) throw readError
  if (!row) return { ok: false, code: 'not_found', message: 'That town no longer exists.' }

  const count = await countListingsBy(supabase, 'town_id', id)
  if (count > 0) {
    return { ok: false, code: 'precondition', message: inUseMessage('town', row.name, count) }
  }

  const { data: deleted, error } = await supabase.from('towns').delete().eq('id', id).select('id')

  if (error) {
    if (error.code === FK_VIOLATION) {
      return { ok: false, code: 'precondition', message: deleteRaceMessage(row.name) }
    }
    if (error.code === RLS_DENIED) return denied()
    throw error
  }

  if (!deleted.length) {
    return { ok: false, code: 'not_found', message: 'That town no longer exists.' }
  }

  revalidateSettings()
  return { ok: true, message: `Deleted “${row.name}”.` }
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

function featureFieldsFrom(formData: FormData) {
  return {
    name: formData.get('name'),
    sort_order: formData.get('sort_order'),
    is_active: formData.get('is_active'),
  }
}

export async function createFeature(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const raw = { ...featureFieldsFrom(formData), slug: formData.get('slug') }
  const parsed = CreateFeatureSchema.safeParse(raw)
  if (!parsed.success) return invalid(parsed.error, submittedValues(raw))

  const supabase = await createClient()
  const { error } = await supabase.from('features').insert(parsed.data).select('id').single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return conflictResult(
        error,
        { slug: FEATURE_SLUG_TAKEN, name: FEATURE_NAME_TAKEN },
        submittedValues(raw)
      )
    }
    if (error.code === RLS_DENIED) return denied()
    throw error
  }

  revalidateSettings()
  return { ok: true, message: `Added “${parsed.data.name}”.` }
}

/**
 * Renames a feature, or moves it, or archives it — but never re-keys it.
 *
 * This is the action the slug fix in `lib/queries.ts` was shipped for. Until this screen
 * existed nothing could rename a feature, so matching `?feat=` against the NAME happened to
 * work. A rename here would have silently broken every saved link the moment it landed;
 * the public filter now matches on `slug`, which this action cannot change.
 */
export async function updateFeature(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const raw = featureFieldsFrom(formData)
  const parsed = UpdateFeatureSchema.safeParse({ ...raw, id: formData.get('id') })
  if (!parsed.success) return invalid(parsed.error, submittedValues(raw))

  const { id, ...fields } = parsed.data
  const supabase = await createClient()

  const { data, error } = await supabase.from('features').update(fields).eq('id', id).select('id')

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return conflictResult(
        error,
        { slug: FEATURE_SLUG_TAKEN, name: FEATURE_NAME_TAKEN },
        submittedValues(raw)
      )
    }
    if (error.code === RLS_DENIED) return denied()
    throw error
  }

  if (!data.length) {
    return { ok: false, code: 'not_found', message: 'That feature no longer exists.' }
  }

  revalidateSettings()
  return { ok: true, message: `Saved “${fields.name}”.` }
}

/**
 * Deletes a feature, if no listing carries it.
 *
 * `listing_features.feature_id` is ON DELETE RESTRICT (set by apply 1's
 * `20260803090000_listing_encoding_v2_apply1.sql`, confirmed directly against
 * `pg_constraint` before this screen was built), so the database refuses this on its own.
 * Under a CASCADE, this action would have quietly stripped the feature from every listing
 * that had it, with no warning and no record — the count check above is what turns that
 * same refusal into a sentence instead of a bare 23503.
 */
export async function deleteFeature(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getStaffUser()
  if (!user) return denied()

  const parsed = FeatureRefSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return invalid(parsed.error)

  const { id } = parsed.data
  const supabase = await createClient()

  const { data: row, error: readError } = await supabase
    .from('features')
    .select('id, name')
    .eq('id', id)
    .maybeSingle()

  if (readError) throw readError
  if (!row) return { ok: false, code: 'not_found', message: 'That feature no longer exists.' }

  const count = await countFeatureLinks(supabase, id)
  if (count > 0) {
    return { ok: false, code: 'precondition', message: inUseMessage('feature', row.name, count) }
  }

  const { data: deleted, error } = await supabase.from('features').delete().eq('id', id).select('id')

  if (error) {
    if (error.code === FK_VIOLATION) {
      return { ok: false, code: 'precondition', message: deleteRaceMessage(row.name) }
    }
    if (error.code === RLS_DENIED) return denied()
    throw error
  }

  if (!deleted.length) {
    return { ok: false, code: 'not_found', message: 'That feature no longer exists.' }
  }

  revalidateSettings()
  return { ok: true, message: `Deleted “${row.name}”.` }
}
