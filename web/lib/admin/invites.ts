import * as z from 'zod'
import { SITE_URL } from '@/lib/site'
import type { ActionResult } from '@/app/admin/actions'

/**
 * Everything about admin invitations that is a pure function of its arguments: the
 * token's shape, the cookie's attributes, the schemas, the email body, and the mapping
 * from a database answer to something a form can render.
 *
 * It lives in `lib/` rather than in the actions themselves for the same reason
 * `lib/admin/queries.ts` holds the lifecycle graph: `'use server'` will not export a
 * non-async function, and none of this can be unit-tested from inside a module that
 * reaches `next/headers` on its first line. Nothing here opens a Supabase client, reads
 * a cookie or sends an email — the callers do all three.
 *
 * `ActionResult` is imported as a TYPE only, exactly as `app/account/actions.ts` does
 * it, so there is one definition of the shape and one renderer in the UI, and no
 * runtime import cycle (a type import is erased).
 *
 * The one rule that outranks every other line in this file: **the raw token never
 * appears in anything returned to a browser.** Next.js serialises a server action's
 * result into the RSC payload, so a token in an `ActionResult` would be in the page
 * source and in whatever cached that response. The token has exactly two destinations —
 * the invite email, and the link the invitee clicks — and this module is what keeps it
 * to those two.
 */

// ---------------------------------------------------------------------------
// The token, and the cookie that carries it for one hop
// ---------------------------------------------------------------------------

/**
 * 32 bytes of `gen_random_bytes`, hex-encoded by the database: 64 lowercase hex
 * characters, always. Validating the SHAPE costs nothing and means a malformed link —
 * a scanner's truncation, a mail client's line wrap, somebody's guess — never becomes a
 * database round trip. It proves nothing about whether the token is real; only
 * `redeem_admin_invite` can answer that, and it answers 'invalid' six different ways.
 */
export const INVITE_TOKEN_PATTERN = /^[0-9a-f]{64}$/

export function isInviteTokenShape(value: unknown): value is string {
  return typeof value === 'string' && INVITE_TOKEN_PATTERN.test(value)
}

/**
 * The token as the database will read it, or null.
 *
 * `redeem_admin_invite` lower-cases and trims what it is given, deliberately: the emitted
 * alphabet is lower-case hex, so neither step removes any entropy, and both rescue an
 * invitee whose mail client padded or case-shifted the link from an unexplainable
 * 'invalid'. This does the same thing one hop earlier, because a strict check at the
 * front door would refuse those links before the database's rescue could ever fire.
 *
 * Whitespace INSIDE the token is not rescued here and is not rescued there — a token
 * broken across a line is a broken token, and guessing at where the pieces go is not
 * something to do with a credential.
 */
export function normaliseInviteToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim().toLowerCase()
  return isInviteTokenShape(cleaned) ? cleaned : null
}

/**
 * The one-hop cookie. Named in the house style (`ds-vs` is the view session).
 *
 * Its whole purpose is to get the token out of the URL on first touch. Vercel's access
 * log records the full query string of every request, and a `Referer` header carries it
 * to any third party the page later talks to — so a token that stayed in the address bar
 * would be written down in at least two places we do not control. The route handler
 * consumes the link, puts the token here, and redirects to a URL with no query string
 * at all.
 *
 * `path` is scoped to the invite flow so the value is not attached to every other
 * request the browser makes to this site, and fifteen minutes is the whole budget: this
 * cookie only has to survive "click link → read page → press button".
 */
export const INVITE_COOKIE = 'ds-ai'
export const INVITE_COOKIE_PATH = '/admin/invite'
export const INVITE_COOKIE_MAX_AGE = 900

export type InviteCookieOptions = {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: string
  maxAge: number
}

/**
 * `sameSite: 'lax'` rather than 'strict' on purpose: the invitee arrives from their mail
 * client, which is a cross-site navigation, and 'strict' would drop the cookie on the
 * very hop it exists for. Lax still withholds it from cross-site POSTs, which is the
 * case that matters.
 */
export function inviteCookieOptions(): InviteCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: INVITE_COOKIE_PATH,
    maxAge: INVITE_COOKIE_MAX_AGE,
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * The same shape as `EmailField` in `app/account/actions.ts`: trimmed and lower-cased
 * BEFORE the address is validated, because `admin_invites.email` carries a
 * `check (email = lower(email))` and redemption compares the row to the caller's own
 * `auth.users` email. A stored mixed-case row would silently never redeem.
 *
 * The database re-normalises and re-checks the address itself. This copy exists so the
 * person typing it gets a sentence under the field instead of a round trip.
 */
export const InviteEmailField = z
  .string({ error: 'Enter the email address to invite.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'That does not look like an email address.' }))

export const InviteAdminSchema = z.object({ email: InviteEmailField })

export const DemoteAdminSchema = z.object({
  profileId: z.uuid({ error: 'That account could not be identified.' }),
})

// ---------------------------------------------------------------------------
// The invitation email
// ---------------------------------------------------------------------------

/** Static. Nothing anybody typed goes in a subject line (house rule). */
export const INVITE_SUBJECT = 'You have been invited to the DaScout admin'

/** The link that lands on the route handler, which drops the token from the URL. */
export function inviteLinkFor(token: string): string {
  return `${SITE_URL}/admin/invite?token=${token}`
}

/**
 * The invitation, in plain text.
 *
 * The three-step section is not padding. Redemption requires a CONFIRMED mailbox — the
 * database checks `auth.users.email_confirmed_at` — so a brand-new invitee receives two
 * emails: this one, and Supabase's own confirmation message. Somebody who does not know
 * that confirms nothing, presses Accept, is told the invitation is invalid, and files a
 * support ticket. Naming the second email before it arrives is the whole fix.
 *
 * Nothing user-typed goes in here: not the inviter's name, not a note. The only variable
 * parts are a link this application built and a date the database chose.
 */
export function inviteEmailBody(input: { link: string; expiresLabel: string | null }): string {
  return [
    'You have been invited to help manage property listings on DaScout.',
    '',
    'Accept the invitation here:',
    input.link,
    '',
    input.expiresLabel
      ? `The link can be used once and expires on ${input.expiresLabel} (Philippine time).`
      : 'The link can be used once and expires in seven days.',
    '',
    'IMPORTANT — you may get a SECOND email from us.',
    '',
    'Accepting an invitation needs a DaScout account on this exact address, and that',
    'account has to be confirmed first.',
    '',
    'If you do NOT already have a DaScout account:',
    '  1. Open the link above and choose "create an account".',
    '  2. Wait for the SECOND email — "Confirm your email" — and open that link first.',
    '  3. Come back to the link above and press "Accept invitation".',
    '',
    'If you ALREADY have a DaScout account on this address, there is no second email.',
    'Sign in, come back to the link above, and press "Accept invitation".',
    '',
    'If you were not expecting this, you can ignore it. Nothing changes until the',
    'invitation is accepted, and the link stops working after it expires.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Database answers → something a form can render
// ---------------------------------------------------------------------------

/**
 * What went wrong with `create_admin_invite`, decided from the SQLSTATE and NOTHING
 * else. A Postgres message is written for whoever reads the server log; putting one on
 * a screen tells a caller about table names, constraint names and function bodies, and
 * this is the one form in the product whose caller holds the highest privilege there is.
 */
export type InviteFailureKind = 'denied' | 'refused' | 'duplicate' | 'unexpected'

const INSUFFICIENT_PRIVILEGE = '42501'
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'

/**
 * 23514 covers TWO situations and the code cannot tell them apart, because the function
 * raises `check_violation` both for an address its own regex rejects and — since it grew
 * an exception handler around the insert — for two owner sessions racing the same address
 * into the partial unique index. Classifying on the message text instead would be reading
 * a Postgres string, which is the thing this whole layer exists not to do.
 *
 * So both land on 'refused', and the sentence covers both honestly. It is not the loss it
 * looks like: the address has already been through `InviteEmailField` before the call, so
 * the "bad address" half is close to unreachable in practice.
 *
 * 23505 is kept mapped even though the handler above now converts it, because that
 * handler is one edit away from being removed and a raw unique violation must never
 * arrive at a screen as an unhandled fault.
 */
export function classifyInviteError(code: string | null | undefined): InviteFailureKind {
  if (code === INSUFFICIENT_PRIVILEGE) return 'denied'
  if (code === CHECK_VIOLATION) return 'refused'
  if (code === UNIQUE_VIOLATION) return 'duplicate'
  return 'unexpected'
}

/** `revoke_staff_admin` only ever refuses one way, and it is the same 42501. */
export function classifyRevokeError(code: string | null | undefined): 'denied' | 'unexpected' {
  return code === INSUFFICIENT_PRIVILEGE ? 'denied' : 'unexpected'
}

/**
 * The one sentence for a 23514. It has to fit both meanings (see `classifyInviteError`)
 * and it has to be actionable either way, so it names the check to make and the thing to
 * do next without claiming to know which of the two happened.
 */
export const INVITE_REFUSED =
  'That invitation was not created. If you have just sent one to the same address, it may already be on its way — reload the page, check the address, and try again.'

/**
 * A concurrent double-submit is the only way to see this: the function revokes any live
 * invitation for the address before it issues a new one, so two rows can only race each
 * other into the partial unique index.
 */
export const INVITE_DUPLICATE =
  'An invitation to that address is already outstanding. Wait a moment, then send it again if it has not arrived.'

/**
 * The honest sentence for a created-but-unsent invitation.
 *
 * `sendEmail` returns false and never throws, so this branch is reachable whenever the
 * mail provider is having a bad afternoon or the API key is missing. What is left behind
 * is a live 256-bit admin-granting secret that NOBODY holds — it was never written down
 * anywhere but the failed message. That is not a security problem (an unheld secret
 * cannot be redeemed) and it is not a success either, so it must not be reported as one.
 *
 * The row is deliberately NOT rolled back: deleting it would need a second privileged
 * write path on an admin-granting table, which is a far worse thing to build than a dead
 * row. Re-inviting the same address supersedes it.
 */
export const INVITE_NOT_EMAILED =
  'The invitation was created but the email could not be sent, so nobody has received it and nothing has been granted. Send the same address again to issue a fresh invitation.'

/**
 * Sent or not sent — the only two things the super admin is told, and neither carries the
 * token. `values` echoes back the address so a form redrawn after a failure keeps it.
 */
export function describeInviteSend(
  email: string,
  delivered: boolean,
  values: Record<string, string>
): ActionResult {
  if (!delivered) {
    return { ok: false, code: 'unexpected', message: INVITE_NOT_EMAILED, values }
  }
  return {
    ok: true,
    message: `Invitation sent to ${email}. It expires in seven days and can be used once.`,
  }
}

export const REVOKE_DONE =
  'Admin access removed. The account stays, as an ordinary buyer account — their favourites and history are untouched.'

/**
 * `no_change` covers two situations the database refuses to tell apart: the target is
 * not a staff admin (any more), or it is the caller's own row. Neither is an error worth
 * a stack trace, and both mean the same thing to the person looking at the screen — what
 * you are looking at is not what is there.
 */
export const REVOKE_NO_CHANGE =
  'Nothing changed — that account is not a staff admin any more. Reload the page to see the current list.'

export function describeRevokeOutcome(status: string | null | undefined): ActionResult {
  return status === 'revoked'
    ? { ok: true, message: REVOKE_DONE }
    : { ok: false, code: 'conflict', message: REVOKE_NO_CHANGE }
}
