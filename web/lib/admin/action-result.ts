import type * as z from 'zod'

/**
 * The shape every server action answers with, and the four helpers that build it.
 *
 * These all lived in `app/admin/actions.ts` until the settings actions needed them too.
 * They could not simply be imported from there: that file is `'use server'`, which refuses
 * to export anything that is not an async function, so `denied`, `invalid`,
 * `submittedValues` and the SQLSTATE constants were unreachable from any other module and
 * a second copy would have been the only alternative. Moving them here is the same
 * reasoning `lib/admin/property-no.ts` and `lib/admin/invites.ts` already record: the pure
 * parts of an action live in `lib/`, where they can be imported and unit-tested, and the
 * `'use server'` file keeps only the actions themselves.
 *
 * `app/admin/actions.ts` re-exports the two types, so every existing
 * `import type { ActionResult } from '@/app/admin/actions'` keeps working unchanged.
 *
 * Nothing here opens a Supabase client or reads a session.
 */

export type ActionErrorCode =
  | 'validation'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'precondition'
  | 'storage'
  | 'unexpected'

/**
 * One shape for every action, so one renderer in the UI covers all of them.
 * `warning` on a successful result is for work that finished but left something a
 * human should know about — a deleted row whose file could not be removed, say.
 *
 * `values` carries the raw strings the browser just posted, back to the form that
 * posted them. React resets an uncontrolled form as soon as its action settles, so a
 * rejected submission would otherwise wipe every field — including the nine that were
 * fine. Handing the values back is the only way the form can restore them as its new
 * defaults. They are for redisplay only and are validated again on the next submit.
 */
export type ActionResult<T = undefined> =
  | { ok: true; message?: string; warning?: string; data?: T }
  | {
      ok: false
      code: ActionErrorCode
      message: string
      fieldErrors?: Record<string, string>
      values?: Record<string, string>
    }

/** Postgres codes the admin actually has to tell apart. */
export const UNIQUE_VIOLATION = '23505'
export const FK_VIOLATION = '23503'
export const CHECK_VIOLATION = '23514'
export const RAISE_EXCEPTION = 'P0001'
export const RLS_DENIED = '42501'

/**
 * One sentence for every refusal, whether the caller is signed out, signed in as a
 * buyer, or signed in as staff whose profile row has gone. A message that varied
 * would tell an outsider which accounts exist.
 */
export const DENIAL = 'You need a staff account to do that.'

export function denied<T>(): ActionResult<T> {
  return { ok: false, code: 'forbidden', message: DENIAL }
}

/**
 * Turns a zod failure into the shape the forms render: one line under each field, plus
 * a banner for anything that belongs to the form as a whole (a cross-field rule).
 */
export function invalid<T>(error: z.ZodError, values?: Record<string, string>): ActionResult<T> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field !== 'string' || field in fieldErrors) continue
    fieldErrors[field] = issue.message
  }

  const formLevel = error.issues.find((issue) => issue.path.length === 0)?.message

  return {
    ok: false,
    code: 'validation',
    message: formLevel ?? 'Some of the details need fixing.',
    fieldErrors,
    values,
  }
}

/**
 * The posted strings, ready to be echoed back to a form that has to be redrawn.
 * Anything that is not a string — an absent field, an unticked checkbox, a file — is
 * dropped rather than turned into "null", so the form falls back to its own default
 * for those instead of showing a word the clerk never typed.
 */
export function submittedValues(raw: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [field, value] of Object.entries(raw)) {
    if (typeof value === 'string') values[field] = value
  }
  return values
}

export const blankToNull = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? null : value

export const blankToUndefined = (value: unknown) =>
  value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value
