import * as z from 'zod'

/**
 * The property number: the admin's own handle on a listing, typed in by hand.
 *
 * Everything here is a pure function of its arguments — the normalisation the database
 * expects, and the reading of a unique violation. It lives in `lib/` rather than inside
 * `app/admin/actions.ts` for the same reason `lib/admin/invites.ts` does: `'use server'`
 * will not export a non-async function, so a schema or a classifier declared there can
 * never be unit-tested. Nothing in this file opens a Supabase client.
 *
 * The column is defined by `20260802131500_property_number_and_role_audit.sql`:
 *
 *   check (property_no is null or (property_no = btrim(property_no)
 *                                  and length(property_no) between 1 and 24))
 *   unique index on (upper(property_no)) where property_no is not null
 *
 * Both halves of that shape are why `normalisePropertyNo` exists. The database would
 * refuse '  DS-0142  ' outright, and it treats `ds-0142` and `DS-0142` as the same
 * reference — so the value is trimmed and upper-cased here, once, before it is written
 * or compared, instead of at each of the places that touch it.
 */

/** The `length(...) between 1 and 24` half of the check constraint. */
export const PROPERTY_NO_MAX = 24

/**
 * What the database will actually store, or null.
 *
 * The empty string is the case worth naming. A clerk who clears the field posts `''`,
 * and storing that would fail the shape check outright — but worse, if it ever were
 * stored, every cleared listing would collide with every other cleared listing on the
 * unique index. Null is the value that means "no reference yet", and Postgres treats
 * nulls as distinct, so any number of listings can share the absence of one. Blank
 * therefore has to become null and never `''`.
 *
 * Anything that is not a string — an absent form field arrives as null — is also null:
 * the field is optional, and a missing one means the same thing as a cleared one.
 */
export function normalisePropertyNo(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // `toUpperCase`, not `toLocaleUpperCase`: the case fold has to match `upper()` in the
  // index, which does not vary with anybody's locale.
  const cleaned = value.trim().toUpperCase()
  return cleaned === '' ? null : cleaned
}

/**
 * The form field, for both the create and the update schema.
 *
 * Optional by decision, not by oversight: §2 of the migration records why a property
 * number is not required to publish this round. The form asks for one; nothing refuses a
 * listing that has none.
 */
export const PropertyNoField = z.preprocess(
  normalisePropertyNo,
  z
    .string()
    .max(PROPERTY_NO_MAX, {
      error: `Keep the property number to ${PROPERTY_NO_MAX} characters or fewer.`,
    })
    .nullable()
)

/** Never shown with the number that clashed: the other listing is not this clerk's business. */
export const PROPERTY_NO_TAKEN = 'That property number is already used by another listing.'

/** The index that raises the 23505 this module reads. Named for the reader, not matched on. */
export const PROPERTY_NO_INDEX = 'listings_property_no_unique_idx'

const UNIQUE_VIOLATION = '23505'

/**
 * Whether a failed listing write collided on the property number rather than on the slug.
 *
 * This is the one place in the admin that reads a Postgres MESSAGE, and it is deliberate.
 * `listings` carries two unique indexes an admin can trip — the slug and the property
 * number — and both raise the same SQLSTATE, so 23505 alone cannot say which. Everywhere
 * else the rule holds: the message is read here to route the failure, and never leaves
 * this module. What the clerk sees is `PROPERTY_NO_TAKEN`, a fixed sentence that names no
 * table, index or value.
 *
 * `details` is checked as well as `message` because PostgREST puts the constraint name in
 * one and `Key (upper(property_no))=(…) already exists` in the other, and which of the two
 * arrives has changed between PostgREST versions. If neither mentions the column the
 * answer is false, and the caller falls back to its existing slug handling — the failure
 * mode is the message that was already there, not a wrong new one.
 */
export function isPropertyNoConflict(
  error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined
): boolean {
  if (!error || error.code !== UNIQUE_VIOLATION) return false
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  return text.includes('property_no')
}
