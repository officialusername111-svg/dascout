/**
 * The sentences the account surfaces are allowed to say back to a visitor.
 *
 * They live in their own module, free of `next/headers`, so the client panels and the
 * server actions render the same words — a message that drifted between the two would
 * be a message nobody maintains.
 *
 * Two of them are deliberately uniform. `RESET_SENT` and `SIGNUP_SENT` are returned for
 * EVERY outcome of their action, including a rate limit: GoTrue's per-address 60-second
 * cooldown shares its error code with the project-wide send budget and only fires for
 * addresses that already exist, so any honest rate-limit sentence on those two forms
 * would be a one-bit oracle telling an outsider which email addresses have accounts.
 * The honest `RATE_LIMITED` sentence survives only where the caller is already
 * authenticated as themselves (changing their own password), where there is nothing
 * left to enumerate.
 */

/**
 * Verbatim the admin module's sign-in refusal. It must not vary with whether the email
 * is registered, and the two copies must change together — if you edit one, edit both.
 */
export const SIGNIN_FAILED = 'That email and password did not match an account.'

/** One sentence for every refusal on an account surface, signed out or signed in. */
export const ACCOUNT_DENIAL = 'You need to be signed in to do that.'

export const RESET_SENT =
  'If that email has a DaScout account, a reset link is on its way. The link works for one hour.'

export const SIGNUP_SENT =
  'Check your email for a confirmation link, then sign in. If you already have an account, sign in instead.'

/** Authenticated surfaces only — never on sign-up or forgot-password. */
export const RATE_LIMITED = 'Too many attempts. Wait a few minutes and try again.'

/**
 * What the callback route bounces back with, rendered by the auth dialog. Keyed by the
 * `reason` it puts in the query string; anything unrecognised renders nothing at all.
 */
export const CALLBACK_REASONS: Record<string, string> = {
  'wrong-browser':
    'That link was opened in a different browser or device. If your email is already confirmed, sign in with your password — or request a new link from this browser.',
  expired:
    'That link has expired or has already been used. Request a new one and open it in this browser.',
  'link-invalid': 'That link is not one we can read. Request a new one and try again.',
}

export function callbackReasonCopy(reason: string | null | undefined): string | null {
  if (!reason) return null
  return CALLBACK_REASONS[reason] ?? null
}
