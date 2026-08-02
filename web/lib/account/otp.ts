import * as z from 'zod'
import { RATE_LIMITED } from '@/lib/account/messages'
import type { ActionResult } from '@/app/admin/actions'

/**
 * The email confirmation CODE — everything about it that is a pure function of its
 * arguments: the shape, the schema, and the mapping from a GoTrue answer to something a
 * form can render.
 *
 * WHY A CODE AT ALL. The owner's invitation flow is: invite → create an account → enter a
 * code → wait for the owner's approval. Confirming by code instead of by link means a new
 * invitee gets TWO emails (the invitation, then the code) rather than three, and the
 * confirmation happens on the page they are already looking at instead of in a second
 * browser tab that may not share their session.
 *
 * IT REPLACES THE LINK, IT DOES NOT SIT BESIDE IT. Which of the two Supabase sends is a
 * DASHBOARD setting, not code: the "Confirm signup" email template has to use `{{ .Token }}`
 * instead of `{{ .ConfirmationURL }}`. That change is the owner's to make, and until they
 * make it the code in this file is unreachable but harmless — see the note in the run
 * report and in `verifyAccountEmailCode`.
 *
 * IT GRANTS NO ROLE, ON ANY PATH. Confirming an address proves control of a mailbox and
 * nothing else. An invited person who confirms is `pending` — they appear in a queue the
 * owner reads, and only the owner pressing approve writes a role. Two earlier designs made
 * this step promote people automatically and were rejected; nothing in this file may grow
 * into a third attempt.
 *
 * This lives in `lib/` rather than in the action for the reason `lib/admin/invites.ts`
 * gives: `'use server'` will not export a non-async function, and none of this can be
 * unit-tested from inside a module that reaches `next/headers` on its first line.
 * `ActionResult` is imported as a TYPE only, so there is one definition of the shape and
 * no runtime import cycle.
 */

// ---------------------------------------------------------------------------
// The code
// ---------------------------------------------------------------------------

/** GoTrue's `{{ .Token }}` for an email confirmation is six digits. */
export const OTP_CODE_LENGTH = 6

export const OTP_CODE_PATTERN = /^\d{6}$/

/**
 * The code as GoTrue will read it, or null.
 *
 * Spaces and hyphens are stripped first, deliberately. People read a six-digit code off a
 * screen and type it as "123 456" or paste it with a trailing newline, and neither is a
 * different code — refusing those would be refusing the right answer for a formatting
 * reason. Nothing else is rescued: a five-digit code is not a code, and guessing at a
 * missing digit is not something to do with a credential.
 *
 * Unlike the invite token this carries no entropy worth protecting — six digits is a
 * throwaway one-time value that GoTrue rate-limits and expires on its own — but the same
 * rule applies: validating the SHAPE here means a mistyped code never becomes a network
 * round trip, and it proves nothing about whether the code is real.
 */
export function normaliseOtpCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\s-]/g, '')
  return OTP_CODE_PATTERN.test(cleaned) ? cleaned : null
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const OTP_CODE_MALFORMED = `Enter the ${OTP_CODE_LENGTH}-digit code from the email. Digits only.`

/**
 * The address is part of the submission because `verifyOtp` needs it: a confirmation code
 * is only meaningful against the address it was sent to, and at this point in the flow
 * there is no session to read it from. It is trimmed and lower-cased before validation,
 * the same shape as `EmailField` in `app/account/actions.ts`.
 */
export const OtpEmailField = z
  .string({ error: 'Enter the email address you signed up with.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'That does not look like an email address.' }))

export const OtpCodeField = z
  .string({ error: OTP_CODE_MALFORMED })
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(OTP_CODE_PATTERN, { error: OTP_CODE_MALFORMED }))

export const VerifyEmailCodeSchema = z.object({
  email: OtpEmailField,
  code: OtpCodeField,
})

// ---------------------------------------------------------------------------
// GoTrue answers → something a form can render
// ---------------------------------------------------------------------------

export type OtpErrorLike = { code?: string | null; message?: string; status?: number }

/**
 * `{ confirmed: true }` is not an `ActionResult` on purpose: the action has work to do on
 * success (rotate the view-session cookie, read the account's saved properties) that a
 * pure function cannot do. Same split, same shape, as `describeSignUpOutcome`.
 */
export type OtpOutcome = { confirmed: true } | ActionResult

/**
 * ONE SENTENCE FOR EVERY BAD CODE — and that is a security property, not tidiness.
 *
 * GoTrue answers a wrong code, an expired code, an already-used code and a code for an
 * address that has no account with the same `otp_expired`. Splitting them would turn this
 * form into a way to ask "does this address have an account?" one address at a time.
 */
export const OTP_CODE_REFUSED =
  'That code did not work. Codes expire after about an hour and can only be used once — check the newest email and type the code again.'

export const OTP_CONFIRMED = 'Your email address is confirmed and you are signed in.'

/** The generic. Same wording as the account module's, so the product says one thing. */
export const OTP_FAILED = 'That did not go through. Try again.'

/**
 * What a `verifyOtp` response means, as a pure function of the response.
 *
 * The rate limit gets the honest sentence here, unlike on sign-up and forgot-password.
 * The limit that fires on a verify is per IP and per code attempt, not per address: it
 * tells an outsider that THEY have been trying too often, which they already know, and
 * nothing about whether any particular address exists. Saying "that code did not work"
 * to somebody who has simply been throttled would send them off to request a new code
 * that will not arrive either.
 */
export function describeOtpOutcome(
  hasSession: boolean,
  error: OtpErrorLike | null
): OtpOutcome {
  if (error) {
    const code = error.code ?? ''

    if (code === 'otp_expired' || code === 'validation_failed') {
      return {
        ok: false,
        code: 'validation',
        message: OTP_CODE_REFUSED,
        fieldErrors: { code: OTP_CODE_REFUSED },
      }
    }

    if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
      return { ok: false, code: 'conflict', message: RATE_LIMITED }
    }

    // The code, never the address and never the digits. This line is read by whoever is
    // holding a ticket that says "it didn't work around 10 AM".
    console.warn('[account] unmapped otp error code:', code || `status ${error.status ?? '?'}`)
    return { ok: false, code: 'unexpected', message: OTP_FAILED }
  }

  // A successful verify returns a session. No session and no error is a state nothing here
  // understands, and it must NOT be reported as a confirmation: telling somebody their
  // address is confirmed when we cannot see that it is would send them to a sign-in that
  // then refuses them.
  if (!hasSession) {
    console.warn('[account] otp verify returned neither a session nor an error')
    return { ok: false, code: 'unexpected', message: OTP_FAILED }
  }

  return { confirmed: true }
}
