'use server'

import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import * as z from 'zod'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getAccountUser, hasRecentRecovery } from '@/lib/account/auth'
import { SITE_URL } from '@/lib/site'
import {
  ACCOUNT_DENIAL,
  RATE_LIMITED,
  RESET_SENT,
  SIGNIN_FAILED,
  SIGNUP_SENT,
} from '@/lib/account/messages'
import type { ActionResult } from '@/app/admin/actions'
import type { Database } from '@/lib/database.types'

/**
 * Every write a signed-in (or signing-in) visitor can make.
 *
 * These live here rather than in `app/admin/actions.ts` on purpose. Every action in that
 * module opens with a staff guard; mixing buyer-callable actions into it is how a future
 * copy-paste ends up shipping a staff action with no guard, or a buyer action that
 * refuses everyone. The `ActionResult` shape is imported from there as a TYPE so there
 * is still exactly one definition of it and one renderer in the UI.
 *
 * Three rules hold for all of them:
 *
 * 1. A server action is a public POST endpoint whichever page renders its form, so the
 *    guarded ones re-check the caller on their first line. Rendering a page behind
 *    `requireAccountUser()` proves nothing about who sent the request.
 * 2. Nothing the browser sends is trusted for identity. The actor is always
 *    `auth.getUser()`; `profile_id` is never read off a form.
 * 3. No submitted password, and no submitted email address or name, is ever echoed into
 *    a log line. Failures log the GoTrue or Postgres error CODE and nothing else. The
 *    `values` handed back to a form for redisplay carry the email and the name, because
 *    the form needs them to redraw — they never carry a password field.
 */

// ---------------------------------------------------------------------------
// Shared plumbing (local re-implementations of the admin module's helpers, which
// `'use server'` will not let that module export because they are not async)
// ---------------------------------------------------------------------------

/** Postgres codes this module has to tell apart. Same constants as the admin module. */
const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'
const RLS_DENIED = '42501'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The view-session cookie `app/actions.ts` issues. Same name, same attributes. */
const VIEW_SESSION_COOKIE = 'ds-vs'
const ONE_YEAR = 60 * 60 * 24 * 365

/** Per-account row ceiling. Not a product limit — a bound on what abuse can write. */
const FAVORITES_CEILING = 1000

/** `in (…)` list size for slug resolution. Keeps the URL PostgREST builds sane. */
const RESOLVE_CHUNK = 50

/** Roughly 8 KB of JSON. Checked before zod walks the array, not after. */
const MAX_SYNC_PAYLOAD = 8 * 1024

const GENERIC_FAILURE = 'That did not go through. Try again.'
const NOT_CONFIRMED = 'Your account is not confirmed yet. Open the link in the email we sent.'
const EMAIL_REFUSED = 'That email address is not accepted. Use a real, deliverable address.'
const PASSWORD_REFUSED = 'That password was refused. Choose a longer, less common one.'
const SAME_PASSWORD = 'Choose a password different from your current one.'
const OVER_CEILING = 'Your account has reached the favourites limit.'

function denied<T>(): ActionResult<T> {
  return { ok: false, code: 'forbidden', message: ACCOUNT_DENIAL }
}

/**
 * Turns a zod failure into the shape the forms render: one line under each field, plus a
 * banner for anything that belongs to the form as a whole (a cross-field rule).
 */
function invalid<T>(error: z.ZodError, values?: Record<string, string>): ActionResult<T> {
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
 *
 * Callers pass only the fields they want back. No password field is ever handed to this
 * function, so no password can be handed back to a browser (or into a React error
 * overlay) by an accident of refactoring.
 */
function submittedValues(raw: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [field, value] of Object.entries(raw)) {
    if (typeof value === 'string') values[field] = value
  }
  return values
}

const blankToNull = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? null : value

/**
 * Issues a fresh view-session id.
 *
 * Called at every authentication boundary — sign-in, a sign-up that came back with a
 * session, sign-out, and clearing history. `listing_views` holds one row per listing per
 * session per day, so without this a visitor who browsed anonymously and then signed in
 * would collide with their own anonymous rows on re-insert and their post-sign-in views
 * would never be attributed to them. Rotating the id makes attribution at INSERT simply
 * work, with no back-fill and no privileged claim function anywhere.
 *
 * The same-day anonymous prefix stays unattributed, by design: it was recorded before
 * anyone said who they were, and the browser's own history covers displaying it.
 */
async function rotateViewSession(): Promise<void> {
  const jar = await cookies()
  jar.set(VIEW_SESSION_COOKIE, randomUUID(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR,
  })
}

type AuthErrorLike = { code?: string | null; message?: string; status?: number }

/**
 * GoTrue error → something a form can render.
 *
 * `invalid_credentials` always lands on the password field and always says the same
 * sentence, whether it was the email or the password that was wrong: a message that
 * varied — or a field error that moved — would tell an outsider which addresses have
 * accounts.
 *
 * `over_request_rate_limit` gets the honest sentence here because every caller of this
 * mapper is either signing themselves in or already signed in as themselves. The limit
 * fires per IP, so it discloses nothing about any particular address. The sign-up and
 * forgot-password actions never reach this mapper for that reason; they answer with one
 * uniform sentence whatever happens.
 */
function mapAuthError<T>(
  error: AuthErrorLike,
  fields: { password: string; email?: string }
): ActionResult<T> {
  const code = error.code ?? ''

  switch (code) {
    case 'invalid_credentials':
      return {
        ok: false,
        code: 'validation',
        message: SIGNIN_FAILED,
        fieldErrors: { [fields.password]: SIGNIN_FAILED },
      }

    case 'email_not_confirmed':
      return { ok: false, code: 'precondition', message: NOT_CONFIRMED }

    case 'email_address_invalid':
      return {
        ok: false,
        code: 'validation',
        message: EMAIL_REFUSED,
        fieldErrors: { [fields.email ?? 'email']: EMAIL_REFUSED },
      }

    case 'weak_password':
    case 'validation_failed':
      return {
        ok: false,
        code: 'validation',
        message: PASSWORD_REFUSED,
        fieldErrors: { [fields.password]: PASSWORD_REFUSED },
      }

    case 'same_password':
      return {
        ok: false,
        code: 'validation',
        message: SAME_PASSWORD,
        fieldErrors: { [fields.password]: SAME_PASSWORD },
      }

    case 'over_request_rate_limit':
      return { ok: false, code: 'conflict', message: RATE_LIMITED }

    case 'session_not_found':
    case 'refresh_token_not_found':
      return { ok: false, code: 'forbidden', message: ACCOUNT_DENIAL }

    default:
      // The code, never the address. This line is read by whoever is holding a ticket
      // that says "it didn't work around 10 AM".
      console.warn('[account] unmapped auth error code:', code || `status ${error.status ?? '?'}`)
      return { ok: false, code: 'unexpected', message: GENERIC_FAILURE }
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const EmailField = z
  .string({ error: 'Enter your email address.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'That does not look like an email address.' }))

/**
 * Eight characters, where Supabase's own floor is six. Stricter than the backend is the
 * safe direction, and the approved sign-up form promises "At least 8 characters".
 * Seventy-two is bcrypt's ceiling — anything past it is silently ignored by the hash, so
 * a longer passphrase would not be the password the person thinks it is.
 */
const NewPasswordField = z
  .string({ error: 'Choose a password.' })
  .min(8, { error: 'Password must be at least 8 characters.' })
  .max(72, { error: 'Keep the password to 72 characters or fewer.' })

/** True for anything a real display name never contains: C0 controls and DEL. */
function isControlCharacter(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return code < 0x20 || code === 0x7f
}

const FullNameField = z.preprocess(
  blankToNull,
  z
    .string({ error: 'Enter the name you want on your account.' })
    .trim()
    .min(2, { error: 'Enter the name you want on your account.' })
    .max(80, { error: 'Keep the name under 80 characters.' })
    // This value is rendered back on the account page and in staff screens. Control
    // characters in a display name are never a real name and are how a log line or a
    // CSV export gets forged a second row.
    .refine((value) => ![...value].some((char) => isControlCharacter(char)), {
      error: 'That name contains characters that cannot be used.',
    })
)

const SignInSchema = z.object({
  email: EmailField,
  password: z.string({ error: 'Enter your password.' }).min(1, { error: 'Enter your password.' }),
})

const SignUpSchema = z.object({
  email: EmailField,
  fullName: FullNameField,
  password: NewPasswordField,
})

const ForgotSchema = z.object({ email: EmailField })

const ChangePasswordSchema = z
  .object({
    currentPassword: z
      .string({ error: 'Enter your current password.' })
      .min(1, { error: 'Enter your current password.' }),
    newPassword: NewPasswordField,
    confirmPassword: z.string({ error: 'Type the new password again.' }),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    error: 'The two new passwords do not match.',
    path: ['confirmPassword'],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    error: SAME_PASSWORD,
    path: ['newPassword'],
  })

const ResetPasswordSchema = z
  .object({
    newPassword: NewPasswordField,
    confirmPassword: z.string({ error: 'Type the new password again.' }),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    error: 'The two new passwords do not match.',
    path: ['confirmPassword'],
  })

const SyncSchema = z.object({
  favoriteSlugs: z
    .array(z.string().trim().max(90).regex(SLUG_PATTERN, { error: 'Unrecognised listing.' }))
    .max(200, { error: 'That was more saved properties than we can take in one go.' }),
})

const FavoriteSchema = z.object({
  slug: z.string().trim().max(90).regex(SLUG_PATTERN, { error: 'Unrecognised listing.' }),
  saved: z.boolean(),
})

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

export type AccountBootstrap = {
  userId: string
  role: Database['public']['Enums']['user_role']
  favoriteSlugs: string[]
  unresolvedSlugs: string[]
}

type ServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * The account's favourite slugs, newest first.
 *
 * `listings!inner` matters: a favourite whose listing has gone back to draft is
 * invisible to public policy, and handing its slug to the browser would put a slug in
 * the mirror that no page can render. The browser keeps its own unresolved slugs
 * separately, which is what makes the merge lossless without this read lying.
 */
async function readFavoriteSlugs(supabase: ServerClient, profileId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('favorites')
    .select('created_at, listings!inner ( slug )')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(FAVORITES_CEILING)

  if (error) throw error

  return (data as unknown as { listings: { slug: string } | null }[])
    .map((row) => row.listings?.slug)
    .filter((slug): slug is string => Boolean(slug))
}

async function countFavorites(supabase: ServerClient, profileId: string): Promise<number> {
  const { count, error } = await supabase
    .from('favorites')
    .select('listing_id', { count: 'exact', head: true })
    .eq('profile_id', profileId)

  if (error) throw error
  return count ?? 0
}

/**
 * One statement, whatever the batch size: atomic, and idempotent by `ignoreDuplicates`.
 * Re-running a merge writes nothing the second time, which is what makes it safe for
 * `AccountSync` to run on any mount without bookkeeping.
 */
function insertFavoriteRows(supabase: ServerClient, profileId: string, listingIds: string[]) {
  return supabase.from('favorites').upsert(
    listingIds.map((listingId) => ({ profile_id: profileId, listing_id: listingId })),
    { onConflict: 'profile_id,listing_id', ignoreDuplicates: true }
  )
}

// ---------------------------------------------------------------------------
// A1 — sign in
// ---------------------------------------------------------------------------

/**
 * Signs a visitor in from the public dialog.
 *
 * There is no role gate here, unlike the admin door. Staff and admins are people with
 * favourites too, and this is the public front door — they land exactly where a buyer
 * lands. The admin door keeps its own eviction of non-staff, which is the check that
 * actually matters.
 *
 * It does not redirect. Setting the session cookie in a server action makes Next re-run
 * the current page and its layouts on the server, which is what flips the header to
 * "Account" without a manual refresh; the dialog just closes itself. The returned
 * bootstrap is the account's favourites as they stand — the merge with whatever this
 * browser has saved is `AccountSync`'s job, and it is the only thing that does it.
 */
export async function signInBuyer(
  _previous: ActionResult<AccountBootstrap> | null,
  formData: FormData
): Promise<ActionResult<AccountBootstrap>> {
  const raw = { email: formData.get('email'), password: formData.get('password') }
  const parsed = SignInSchema.safeParse(raw)
  if (!parsed.success) return invalid(parsed.error, submittedValues({ email: raw.email }))

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    const failure = mapAuthError<AccountBootstrap>(error, { password: 'password' })
    return failure.ok ? failure : { ...failure, values: submittedValues({ email: raw.email }) }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, code: 'unexpected', message: 'Sign-in did not complete. Try again.' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  await rotateViewSession()

  return {
    ok: true,
    data: {
      userId: user.id,
      role: profile?.role ?? 'buyer',
      favoriteSlugs: await readFavoriteSlugs(supabase, user.id),
      unresolvedSlugs: [],
    },
  }
}

// ---------------------------------------------------------------------------
// A2 — sign up
// ---------------------------------------------------------------------------

export type SignUpOutcome = { signedIn: true } | ActionResult

/**
 * What a `signUp` response means, as a pure function of the response.
 *
 * This is split out and exported so it can be tested directly, because the property that
 * matters cannot be observed from the outside: the answer for a brand-new address, an
 * address that already exists and is confirmed, an address that already exists and is
 * not confirmed, and an address the send budget has just refused must all be
 * BYTE-IDENTICAL. Any difference between them — a different sentence, a different code,
 * an extra field — is an oracle an outsider can query one address at a time.
 *
 * Supabase makes the difference visible on purpose: a signup for an existing confirmed
 * address comes back with a fabricated user whose `identities` array is empty. Nothing
 * here branches on that. It is read by nothing and reported by nothing.
 *
 * It is `async` only because a `'use server'` module may export nothing else; there is
 * no I/O in it and no state.
 */
export async function describeSignUpOutcome(
  data: { user?: unknown; session?: unknown } | null,
  error: AuthErrorLike | null
): Promise<SignUpOutcome> {
  if (error) {
    const code = error.code ?? ''

    // The per-address 60-second cooldown and the project-wide send budget share this
    // code, and the per-address one only fires for addresses that exist. Saying "too
    // many attempts" here would answer "does this address have an account?" for free.
    if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
      return { ok: true, message: SIGNUP_SENT }
    }

    if (code === 'email_address_invalid') {
      return {
        ok: false,
        code: 'validation',
        message: EMAIL_REFUSED,
        fieldErrors: { email: EMAIL_REFUSED },
      }
    }

    if (code === 'weak_password' || code === 'validation_failed') {
      return {
        ok: false,
        code: 'validation',
        message: PASSWORD_REFUSED,
        fieldErrors: { password: PASSWORD_REFUSED },
      }
    }

    console.warn('[account] unmapped signup error code:', code || `status ${error.status ?? '?'}`)
    return { ok: false, code: 'unexpected', message: GENERIC_FAILURE }
  }

  // A session comes back only when email confirmation is switched OFF for the project.
  // It is on today, so this branch is the one that keeps working if that ever changes.
  if (data?.session) return { signedIn: true }

  return { ok: true, message: SIGNUP_SENT }
}

/**
 * Creates an account.
 *
 * The display name travels in `options.data.full_name`, which a database trigger copies
 * into `profiles.full_name`. The confirmation link comes back to `/auth/callback`, and
 * its address is built from the compile-time `SITE_URL` — never from a request header,
 * which an attacker can set to a host of their choosing and would hand them the code.
 */
export async function signUpBuyer(
  _previous: ActionResult<AccountBootstrap> | null,
  formData: FormData
): Promise<ActionResult<AccountBootstrap>> {
  const raw = {
    email: formData.get('email'),
    fullName: formData.get('fullName'),
    password: formData.get('password'),
  }
  const parsed = SignUpSchema.safeParse(raw)
  if (!parsed.success) {
    return invalid(parsed.error, submittedValues({ email: raw.email, fullName: raw.fullName }))
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${SITE_URL}/auth/callback?next=%2Faccount`,
    },
  })

  const outcome = await describeSignUpOutcome(data, error)

  if ('signedIn' in outcome) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return { ok: false, code: 'unexpected', message: 'Sign-up did not complete. Try again.' }
    }

    await rotateViewSession()

    return {
      ok: true,
      message: 'Welcome to DaScout.',
      data: {
        userId: user.id,
        role: 'buyer',
        favoriteSlugs: await readFavoriteSlugs(supabase, user.id),
        unresolvedSlugs: [],
      },
    }
  }

  if (outcome.ok) return outcome

  return { ...outcome, values: submittedValues({ email: raw.email, fullName: raw.fullName }) }
}

// ---------------------------------------------------------------------------
// A3 — sign out
// ---------------------------------------------------------------------------

/**
 * Signs the visitor out everywhere.
 *
 * The default global scope is right here — this is the person asking to be signed out,
 * and "sign out" that left other devices signed in is not what anybody means by it.
 *
 * `redirect` throws by design, so it is the last statement and sits outside any
 * try/catch. The button that submits this form clears the local mirror FIRST, so the
 * next person on a shared machine inherits nothing that came off the account.
 */
export async function signOutAccount(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  await rotateViewSession()
  redirect('/')
}

// ---------------------------------------------------------------------------
// A4 — forgot password
// ---------------------------------------------------------------------------

/**
 * Sends a password-reset link, and says the same thing whatever happened.
 *
 * One sentence for a registered address, an unregistered one, a malformed-but-parseable
 * one, and a rate limit. The response to this form must not be a way to find out which
 * email addresses have DaScout accounts, and every distinguishable outcome is exactly
 * that. Real failures go to the server log as a bare error code.
 *
 * It runs on the COOKIE client rather than a throwaway one because
 * `resetPasswordForEmail` starts a PKCE exchange: the verifier has to land in this
 * browser's cookies, or the callback will have nothing to exchange the code against and
 * the link will fail for the one person entitled to use it.
 */
export async function requestPasswordReset(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const raw = { email: formData.get('email') }
  const parsed = ForgotSchema.safeParse(raw)
  if (!parsed.success) return invalid(parsed.error, submittedValues(raw))

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${SITE_URL}/auth/callback?next=${encodeURIComponent('/account/password?reset=1')}`,
  })

  if (error) console.warn('[account] reset request error code:', error.code ?? error.status ?? '?')

  return { ok: true, message: RESET_SENT }
}

// ---------------------------------------------------------------------------
// A5 — change password (knows the current one)
// ---------------------------------------------------------------------------

/**
 * Changes the password of the caller's own account.
 *
 * Supabase does not require the old password for `updateUser({ password })`. Without a
 * re-authentication step, then, a stolen session cookie is a silent account takeover:
 * whoever holds it sets a new password and owns the account. So the current password is
 * checked first — and checked in a way that cannot damage the caller:
 *
 * - The probe is a per-call client built inside this function with `persistSession:
 *   false`. Module scope would share it between concurrent requests; the cookie client
 *   would overwrite the caller's own session with the probe's.
 * - It is revoked in a `finally`, with `scope: 'local'`. A bare `signOut()` defaults to
 *   GLOBAL and would sign the caller out of the very session they are using.
 *
 * A successful change then signs out every OTHER device. Someone changing their password
 * defensively believes it locks other people out; before this it did not.
 */
export async function changePassword(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getAccountUser()
  if (!user) return denied()

  const parsed = ChangePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  })
  // No `values` here and nowhere below: every field on this form is a password.
  if (!parsed.success) return invalid(parsed.error)

  if (!user.email) {
    return {
      ok: false,
      code: 'precondition',
      message: 'Your account has no email address on it, so the password cannot be changed here.',
    }
  }

  const probe = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  )

  let reauthFailure: ActionResult | null = null
  try {
    const { error } = await probe.auth.signInWithPassword({
      email: user.email,
      password: parsed.data.currentPassword,
    })

    if (error) {
      if (error.code === 'over_request_rate_limit') {
        reauthFailure = { ok: false, code: 'conflict', message: RATE_LIMITED }
      } else {
        const sentence = 'That is not your current password.'
        reauthFailure = {
          ok: false,
          code: 'validation',
          message: sentence,
          fieldErrors: { currentPassword: sentence },
        }
      }
    }
  } finally {
    // Local scope only. The probe's token dies with it; the caller's does not.
    await probe.auth.signOut({ scope: 'local' })
  }

  if (reauthFailure) return reauthFailure

  const supabase = await createClient()
  const { error: updateError } = await supabase.auth.updateUser({
    password: parsed.data.newPassword,
  })
  if (updateError) return mapAuthError(updateError, { password: 'newPassword' })

  const { error: othersError } = await supabase.auth.signOut({ scope: 'others' })
  if (othersError) {
    console.warn('[account] sign-out-others failed:', othersError.code ?? othersError.status ?? '?')
    return {
      ok: true,
      message: 'Password changed.',
      warning:
        'Your password is changed, but we could not sign out your other devices. Sign in again on this device later to retry, or contact DaScout if you think someone else has access.',
    }
  }

  return {
    ok: true,
    message: 'Password changed. You are still signed in here; every other device has been signed out.',
  }
}

// ---------------------------------------------------------------------------
// A6 — set a password after a reset link
// ---------------------------------------------------------------------------

/**
 * Sets a new password for a session that arrived through a verified recovery link.
 *
 * Both gates are checked here and not just on the page that renders the form: signed in
 * at all, and signed in through a recovery link within the last fifteen minutes. The
 * second one is read from the session's own `amr` claim, so an ordinary stolen session
 * cookie cannot reach this action no matter what query string it arrives with.
 *
 * An expired window is a message with a way out, not a dead end — somebody who typed
 * their new password too slowly needs to be told to request another link, not shown a
 * blank refusal.
 */
export async function resetPassword(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getAccountUser()
  if (!user) return denied()

  const supabase = await createClient()
  if (!(await hasRecentRecovery(supabase))) {
    return {
      ok: false,
      code: 'precondition',
      message: 'That reset link has expired. Request a new one from "Forgot password".',
    }
  }

  const parsed = ResetPasswordSchema.safeParse({
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword })
  if (error) return mapAuthError(error, { password: 'newPassword' })

  const { error: othersError } = await supabase.auth.signOut({ scope: 'others' })
  if (othersError) {
    console.warn('[account] sign-out-others failed:', othersError.code ?? othersError.status ?? '?')
    return {
      ok: true,
      message: 'Password updated.',
      warning:
        'Your password is updated, but we could not sign out your other devices. If you were resetting because someone else may have had access, contact DaScout.',
    }
  }

  return {
    ok: true,
    message: 'Password updated. You are signed in here; every other device has been signed out.',
  }
}

// ---------------------------------------------------------------------------
// A7 — the merge
// ---------------------------------------------------------------------------

/**
 * Merges this browser's saved properties into the account, and hands back the account's
 * full set.
 *
 * This is the phase's named risk, so it is worth being explicit about what makes it
 * safe. It is a union in both directions and there is no deletion step anywhere in it.
 * The upsert is one statement with `ignoreDuplicates`, so it is atomic and re-running it
 * writes nothing. Slugs that cannot be resolved to a listing — the listing went back to
 * draft, or was withdrawn, so public policy hides it — are reported back rather than
 * dropped, and the browser keeps them. Even the refusal path is lossless: if the account
 * is at its ceiling nothing is written and the local list is untouched.
 *
 * Callers pass only what they want uploaded. `AccountSync` sends the local set on the
 * first merge for a given account on a given device and an empty array on every mount
 * after that, which is what lets a favourite removed on another device stay removed
 * instead of being resurrected from a stale mirror.
 */
export async function syncAccountState(input: {
  favoriteSlugs: string[]
}): Promise<ActionResult<AccountBootstrap>> {
  const user = await getAccountUser()
  if (!user) return denied()

  // Size first. zod would happily walk a ten-megabyte array before rejecting it, and
  // the walk is the expensive part.
  let payloadSize = MAX_SYNC_PAYLOAD + 1
  try {
    payloadSize = JSON.stringify(input ?? null)?.length ?? payloadSize
  } catch {
    // Circular or otherwise unserialisable: treat as over the limit.
  }
  if (payloadSize > MAX_SYNC_PAYLOAD) {
    return {
      ok: false,
      code: 'validation',
      message: 'That was more saved properties than we can take in one go.',
    }
  }

  const parsed = SyncSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const submitted = [...new Set(parsed.data.favoriteSlugs)]
  const supabase = await createClient()

  // Resolve slug → id in chunks. No status filter: public policy already limits this to
  // live and sold, and a filter written here would be a second, drifting copy of it.
  const resolved = new Map<string, string>()
  for (let index = 0; index < submitted.length; index += RESOLVE_CHUNK) {
    const chunk = submitted.slice(index, index + RESOLVE_CHUNK)
    const { data, error } = await supabase.from('listings').select('id, slug').in('slug', chunk)
    if (error) {
      if (error.code === RLS_DENIED) return denied()
      throw error
    }
    for (const row of data ?? []) resolved.set(row.slug, row.id)
  }

  const unresolvedSlugs = submitted.filter((slug) => !resolved.has(slug))
  const listingIds = [...resolved.values()]
  let warning: string | undefined

  if (listingIds.length) {
    // Count first, refuse whole. A partial merge would leave the browser and the account
    // disagreeing with no way for either to tell which rows made it.
    const current = await countFavorites(supabase, user.id)
    if (current + listingIds.length > FAVORITES_CEILING) {
      return { ok: false, code: 'precondition', message: OVER_CEILING }
    }

    const first = await insertFavoriteRows(supabase, user.id, listingIds)
    if (first.error) {
      const code = first.error.code
      if (code === RLS_DENIED) return denied()
      if (code === FK_VIOLATION) {
        // A listing was deleted between the resolve and the write. Find the survivors,
        // write them, and say plainly how many did not make it.
        const { data: alive, error: aliveError } = await supabase
          .from('listings')
          .select('id')
          .in('id', listingIds)
        if (aliveError) throw aliveError

        const survivors = (alive ?? []).map((row) => row.id)
        if (survivors.length) {
          const retry = await insertFavoriteRows(supabase, user.id, survivors)
          if (retry.error && retry.error.code !== UNIQUE_VIOLATION) {
            if (retry.error.code === RLS_DENIED) return denied()
            throw retry.error
          }
        }

        const dropped = listingIds.length - survivors.length
        if (dropped > 0) {
          warning = `${dropped} saved propert${
            dropped === 1 ? 'y' : 'ies'
          } could not be added because the listing has been removed.`
        }
      } else if (code !== UNIQUE_VIOLATION) {
        // A duplicate is the expected outcome of a re-run, not a failure.
        throw first.error
      }
    }
  }

  const favoriteSlugs = await readFavoriteSlugs(supabase, user.id)

  revalidatePath('/account/favorites')
  revalidatePath('/account/history')

  return {
    ok: true,
    warning,
    data: { userId: user.id, role: user.role, favoriteSlugs, unresolvedSlugs },
  }
}

// ---------------------------------------------------------------------------
// A8 — one heart
// ---------------------------------------------------------------------------

/**
 * Saves or unsaves one property for the signed-in visitor.
 *
 * The browser has already updated itself optimistically by the time this runs, so the
 * only interesting outcomes are the ones it has to undo. A duplicate insert is treated
 * as success — two taps, or a tap on two tabs, mean the same thing as one.
 */
export async function setFavorite(input: {
  slug: string
  saved: boolean
}): Promise<ActionResult<{ slug: string; saved: boolean }>> {
  const user = await getAccountUser()
  if (!user) return denied()

  const parsed = FavoriteSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const { slug, saved } = parsed.data
  const supabase = await createClient()

  const { data: listing, error: readError } = await supabase
    .from('listings')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (readError) {
    if (readError.code === RLS_DENIED) return denied()
    throw readError
  }
  if (!listing) {
    return { ok: false, code: 'not_found', message: 'That listing is no longer available.' }
  }

  if (saved) {
    const current = await countFavorites(supabase, user.id)
    if (current + 1 > FAVORITES_CEILING) {
      return { ok: false, code: 'precondition', message: OVER_CEILING }
    }

    const { error } = await insertFavoriteRows(supabase, user.id, [listing.id])
    if (error && error.code !== UNIQUE_VIOLATION) {
      if (error.code === RLS_DENIED) return denied()
      if (error.code === FK_VIOLATION) {
        return { ok: false, code: 'not_found', message: 'That listing is no longer available.' }
      }
      throw error
    }
  } else {
    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('profile_id', user.id)
      .eq('listing_id', listing.id)

    if (error) {
      if (error.code === RLS_DENIED) return denied()
      throw error
    }
  }

  revalidatePath('/account/favorites')

  return { ok: true, data: { slug, saved } }
}

// ---------------------------------------------------------------------------
// A9 — clear browsing history
// ---------------------------------------------------------------------------

/**
 * Removes the personal association from the visitor's own view rows.
 *
 * This de-attributes rather than deletes, and the difference is deliberate on both
 * counts. `listing_views` is what the "Top Properties" ranking counts, so a delete grant
 * would let anybody rewrite the site's most-viewed list by viewing and clearing in a
 * loop. And personal data should not be retained in an identifiable form once the person
 * has asked for it to go — setting `profile_id` to null is the stronger privacy answer,
 * not the weaker one. The view still counts; nothing says who made it.
 *
 * It goes through `clear_my_listing_views()` rather than an UPDATE from here, and the
 * reason is worth writing down because it is not obvious. A filtered UPDATE needs SELECT
 * permission for its WHERE clause, and Postgres then also checks the NEW row against the
 * SELECT policies — but a just-de-attached row is owned by nobody and is therefore
 * invisible to its former owner BY DESIGN, so every filtered UPDATE failed 42501. The
 * same statement unfiltered succeeds, and PostgREST will not send an unfiltered update.
 * There was no client-reachable shape at all. The function is the same pattern the admin
 * already uses for a write row-level security cannot express: narrow, SECURITY DEFINER,
 * self-scoped to `auth.uid()` inside, and executable only by `authenticated`. It returns
 * how many rows it detached. The old UPDATE policy and its column grant were dropped with
 * it, so this function is the only de-attach door.
 *
 * The view-session id rotates afterwards so today's later views attribute fresh instead
 * of colliding with the rows just detached.
 */
export async function clearAccountHistory(): Promise<ActionResult> {
  const user = await getAccountUser()
  if (!user) return denied()

  const supabase = await createClient()
  const { error } = await supabase.rpc('clear_my_listing_views')

  if (error) {
    // The function's execute grant is the boundary; a refusal means the caller is not
    // who the guard above thought they were, which is a denial and not a fault.
    if (error.code === RLS_DENIED) return denied()
    throw error
  }

  await rotateViewSession()
  revalidatePath('/account/history')

  // The count comes back and is deliberately not shown. "Cleared 7 of 7" invites the
  // question of which seven, on the one screen whose whole purpose is that there is now
  // no answer to that question.
  return { ok: true, message: 'Browsing history cleared from your account.' }
}
