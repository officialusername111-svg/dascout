import * as z from 'zod'
import { SITE_URL } from '@/lib/site'
import type { ActionResult } from '@/app/admin/actions'

/**
 * Everything about admin invitations that is a pure function of its arguments: the
 * schemas, the email bodies, how a queue row reads, and the mapping from a database
 * answer to something a form can render.
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
 * WHAT USED TO BE AT THE TOP OF THIS FILE, AND WHY IT IS GONE (run-p9, 2026-08-02).
 * Until the self-service door was retired, this module opened with the invitation
 * token's shape (`INVITE_TOKEN_PATTERN`, `isInviteTokenShape`, `normaliseInviteToken`)
 * and the attributes of the one-hop cookie that carried it (`INVITE_COOKIE` — `ds-ai` —
 * `inviteCookieOptions`, and the 15-minute budget). Every one of them existed to get a
 * raw token from a URL into `redeem_admin_invite` safely. That function is no longer
 * callable by anyone (see §5 of `20260802204500_admin_invite_approval_queue.sql`), the
 * token is no longer emailed, and nothing anywhere now handles one — so all of it was
 * deleted rather than left as machinery a future reader would assume is load-bearing.
 *
 * The rule those helpers served is now absolute rather than careful: **the raw token
 * never leaves the database's answer.** `create_admin_invite` still mints one, because
 * `admin_invites.token_hash` is NOT NULL; `inviteAdmin` reads the row for its expiry and
 * discards the token unread. It is not emailed, not put in a cookie, not put in a URL,
 * not logged, and not returned to a browser. There is nowhere left for it to leak to.
 */

// ---------------------------------------------------------------------------
// Where an invitation email points
// ---------------------------------------------------------------------------

/**
 * The landing page for an invitation — and it deliberately carries NOTHING.
 *
 * No token (there is no longer anything a token could do), no id, and no email address.
 * The address matters as much as the secret did: a query string is written into Vercel's
 * access log for every request and handed to any third party the page later talks to via
 * `Referer`, so putting the invitee's address there to pre-fill a field would be logging
 * somebody's personal data in two places we do not control, for a keystroke's convenience.
 *
 * What replaces the old link's job: the page tells the invitee what to do next, and the
 * invitation is matched to them later by the ADDRESS THEY SIGN UP WITH — which is the
 * same fact the queue derives, and the only fact that ever mattered.
 */
export const INVITE_LANDING_PATH = '/admin/invite'

export function inviteLandingLink(): string {
  return `${SITE_URL}${INVITE_LANDING_PATH}`
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

/**
 * Approve and decline take the same one field, so they share one schema.
 *
 * It is an INVITATION id, never a profile id — deliberately, and the database agrees:
 * `approve_admin_invite` resolves the account from the invitation's own address inside
 * the function, so nothing a form posts can aim an approval at a different person. A
 * schema that carried a profileId would be offering exactly that.
 */
export const InviteDecisionSchema = z.object({
  inviteId: z.uuid({ error: 'That invitation could not be identified.' }),
})

// ---------------------------------------------------------------------------
// The invitation email
// ---------------------------------------------------------------------------

/** Static. Nothing anybody typed goes in a subject line (house rule). */
export const INVITE_SUBJECT = 'You have been invited to the DaScout admin'

/**
 * The invitation, in plain text.
 *
 * REWRITTEN for the approval queue (run-p9). The old copy ended "come back and press
 * Accept invitation", which described a flow the owner has replaced: an invitation is now
 * finished by the OWNER approving it, not by the invitee accepting it. An email that
 * promises somebody an acceptance step is an email that generates a support ticket when
 * pressing it is not what grants the access.
 *
 * What the three steps must get across, in order of how often each one goes wrong:
 *
 *   1. The account has to be on THIS address. An invitation matched to a different
 *      address never reaches the queue and looks, to the invitee, like nothing happened.
 *   2. There is a SECOND email carrying a code. Somebody who does not expect it confirms
 *      nothing and waits forever — which is the failure the old copy already existed to
 *      prevent, and it survives the rewrite because the code replaced the link inside
 *      that same message, not the message itself.
 *   3. **A person approves them, and it is not instant.** This is the new sentence and it
 *      is the important one. Silence after step 2 is the normal state of this flow, and
 *      an invitee who was not told that reads it as "it is broken" and emails the owner.
 *
 * Nothing user-typed goes in here: not the inviter's name, not a note. The only variable
 * parts are a link this application built and a date the database chose — and the link
 * now carries no secret and no address, so this email is no longer a thing worth
 * intercepting. `input.link` stays a parameter rather than being inlined so the caller
 * still owns the URL and a test can prove what is in it.
 */
export function inviteEmailBody(input: { link: string; expiresLabel: string | null }): string {
  return [
    'You have been invited to help manage property listings on DaScout.',
    '',
    'Start here:',
    input.link,
    '',
    'WHAT HAPPENS, IN THREE STEPS',
    '',
    '  1. Create a DaScout account on THIS email address. An invitation only works for',
    '     the address it was sent to.',
    '',
    // Kept on one line: "open that one first" is the sentence a reader skims for, and
    // wrapping it across two lines also breaks the test that pins it.
    '  2. You will get a SECOND email from us — "Confirm your email".',
    '     Open that one first: it carries a 6-digit code. Enter the code where the',
    '     site asks for it, and the address is confirmed.',
    '',
    '  3. The DaScout owner approves your account. We email you when they have, and you',
    '     can manage listings from that moment.',
    '',
    'After step 2 you are done. Step 3 is a person, not a machine — nothing is granted',
    'automatically, there is nothing else for you to press, and it may be a while before',
    'the owner gets to it.',
    '',
    'If you ALREADY have a DaScout account on this address there is no second email and',
    'no code. Nothing at all is needed from you — the owner can already see this',
    'invitation waiting for approval.',
    '',
    input.expiresLabel
      ? `The invitation expires on ${input.expiresLabel} (Philippine time).`
      : 'The invitation expires in seven days.',
    '',
    'If you were not expecting this, you can ignore it. Nothing has been granted to',
    'anybody, and the invitation stops working after it expires.',
  ].join('\n')
}

/**
 * The approval notification. Static — this one has no variable parts at all.
 *
 * IT IS A COURTESY, AND IT IS SENT AFTER THE FACT. The role is granted inside
 * `approve_admin_invite`, in one transaction, before this is composed. A mail provider
 * having a bad afternoon must never be able to undo an access decision, so a failed send
 * is reported to the owner as a warning on a successful approval — never as a failure,
 * and never by rolling anything back. Same rule, same reasoning, as `INVITE_NOT_EMAILED`.
 *
 * The one thing it must be clear about is that there is NOTHING TO DO. The role is read
 * from the `profiles` row on every request, so the panel is simply there on the next page
 * load — no link to click, no acceptance, no signing out and back in. Every previous
 * version of this flow ended with an action, and somebody who expects one will go looking
 * for it.
 *
 * It takes no arguments on purpose: with no parameters there is nowhere for anybody's
 * typing to get into an email this application sends.
 */
export const APPROVAL_SUBJECT = 'Your DaScout admin access is now active'

export function approvalEmailBody(): string {
  return [
    'Your DaScout account has been approved. You can now manage property listings.',
    '',
    'Sign in as usual and open the admin panel:',
    `${SITE_URL}/admin`,
    '',
    'There is nothing to set up and nothing to accept. The access is already on your',
    'account — if you are signed in already, the panel is there on your next page load.',
    'You do not need to sign out and back in.',
    '',
    'WHAT YOU CAN DO',
    '  * Create, edit and publish any listing on the site',
    '  * Record title checks and ground validations',
    '  * Upload and reorder photos, and mark a property sold or withdrawn',
    '',
    'WHAT YOU CANNOT DO',
    '  * Invite or remove other admins. That stays with the DaScout owner.',
    '',
    'Everything done in the panel is recorded against the account that did it, including',
    'who published which listing and when.',
    '',
    'If you were not expecting this, tell the DaScout owner. Access can be removed at any',
    'time, and an account whose access is removed carries on as an ordinary account.',
  ].join('\n')
}

/**
 * The "Confirm your email" template — NOT SENT BY THIS APPLICATION.
 *
 * Supabase sends the confirmation message itself, from a template stored in the project
 * dashboard, and whether that message carries a link or a code is decided there and only
 * there. This constant exists so the third email in the flow is written in the same voice
 * as the two above instead of being invented at a keyboard in a browser tab, and so a
 * test can hold it to the one thing that matters: it must use `{{ .Token }}` (the code)
 * and must NOT use `{{ .ConfirmationURL }}` (the link the code replaces).
 *
 * To apply it: Supabase dashboard → Authentication → Emails → Templates → "Confirm
 * signup" → paste, save. Until that is done the project keeps sending the link, this
 * product's code path for the code sits unused, and nothing breaks.
 *
 * HTML rather than plain text because that is what the dashboard template is. Nothing in
 * it is interpolated by us — `{{ .Token }}` is GoTrue's own placeholder.
 */
export const CONFIRM_SIGNUP_TEMPLATE = [
  '<h2>Confirm your email</h2>',
  '<p>Enter this 6-digit code on the DaScout page that asked for it:</p>',
  '<p style="font-size:30px;font-weight:700;letter-spacing:0.3em">{{ .Token }}</p>',
  '<p>The code can be used once and expires in about an hour.</p>',
  '<p>If you were invited to help manage listings, entering this code is the last thing',
  'you need to do — the DaScout owner approves your account after that, and we will',
  'email you when they have.</p>',
  '<p>If you did not create a DaScout account, you can ignore this email.</p>',
].join('\n')

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

// ---------------------------------------------------------------------------
// The approval queue: how a row reads
// ---------------------------------------------------------------------------

/**
 * The two states a waiting invitation can be in, derived from one fact the database
 * computes fresh on every read: does a confirmed account exist on the invited address?
 *
 * Neither state grants anything. `ready` means "you may approve this"; it does not mean
 * anybody has access, and the approval re-derives the same fact under a row lock before
 * it writes. A stale `ready` on a screen is worth exactly nothing.
 */
export type CandidateState = 'ready' | 'not_signed_up'

export function candidateState(hasConfirmedAccount: boolean): CandidateState {
  return hasConfirmedAccount ? 'ready' : 'not_signed_up'
}

export const CANDIDATE_STATE_LABELS: Record<CandidateState, string> = {
  ready: 'Ready',
  not_signed_up: 'Not signed up',
}

/**
 * What the row leads with — and this is load-bearing, not cosmetic.
 *
 * It shows the name on the account THEY created, and falls back to the address the owner
 * typed when there is no account or no name. That fallback is the whole reason the queue
 * is safe to use: the residual risk of this design is the owner approving the wrong
 * person, and a mistyped invitation shows a STRANGER'S NAME sitting next to an address
 * the owner does not recognise. Showing the address alone would hide that; showing the
 * name alone would hide the typo. Do not "tidy" this into one or the other.
 *
 * A whitespace-only name is treated as no name: `profiles.full_name` is nullable and
 * copied from signup metadata, so ' ' is a value that reaches here.
 */
export function candidateDisplayName(
  fullName: string | null | undefined,
  email: string
): string {
  return fullName?.trim() || email
}

/**
 * The second meta line on a row, as one sentence.
 *
 * Two different stories, because the two states have different facts to tell. A ready row
 * says when the person signed up and that the address is confirmed — the two things the
 * owner is deciding on. A not-signed-up row has no account to describe, so it says when
 * the invitation went out and states plainly that nobody has created an account, which is
 * what makes "why is this still here?" answerable without asking anybody.
 *
 * Missing labels are dropped rather than rendered as "null" — `stampLabel` returns null
 * for an unparseable timestamp, and a row with a broken date is still a row the owner
 * needs to see.
 */
export function candidateMetaLine(
  state: CandidateState,
  labels: {
    accountCreatedLabel?: string | null
    invitedLabel?: string | null
    expiresLabel?: string | null
  }
): string {
  const parts: string[] = []

  if (state === 'ready') {
    if (labels.accountCreatedLabel) parts.push(`Account created ${labels.accountCreatedLabel}`)
    parts.push('email confirmed')
  } else {
    if (labels.invitedLabel) parts.push(`Invited ${labels.invitedLabel}`)
    parts.push('no account created yet')
  }

  if (labels.expiresLabel) parts.push(`invitation expires ${labels.expiresLabel}`)

  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// The approval queue: approve, and decline
// ---------------------------------------------------------------------------

/**
 * `approve_admin_invite` and `decline_admin_invite` both refuse exactly one way — 42501,
 * raised by their own `is_super_admin()` check — and answer everything else with a status
 * string rather than an error. So the classifier has two outcomes, like
 * `classifyRevokeError` and unlike `classifyInviteError`.
 *
 * Anything that is not 42501 is a fault: the database is not answering, the migration is
 * not applied (PostgREST replies PGRST202, "Could not find the function"), or the function
 * raised something nobody predicted. None of those is something the person at the keyboard
 * can fix, and none of them may be reported as a tidy sentence that hides a broken system.
 */
export function classifyDecisionError(
  code: string | null | undefined
): 'denied' | 'unexpected' {
  return code === INSUFFICIENT_PRIVILEGE ? 'denied' : 'unexpected'
}

/**
 * The seven answers `approve_admin_invite` can give, as the type the mapper switches on.
 * Kept as a union rather than a string so a value added to the function without a sentence
 * here is a compile error rather than a blank screen.
 */
export type ApproveOutcome =
  | 'approved'
  | 'not_found'
  | 'not_pending'
  | 'expired'
  | 'unconfirmed'
  | 'ambiguous'
  | 'already_admin'

export const APPROVE_DONE =
  'Approved. That account is now an admin with full access to every listing — they can open the admin panel straight away, and their name is in the access record below. We have emailed them to say so.'

/**
 * Approved, but the notification did not go out.
 *
 * It is a WARNING on a successful result, not a failure. The role was granted inside one
 * database transaction before this email was even composed; saying "that did not work"
 * would be false and would invite the owner to press Approve again. `sendEmail` returns
 * false and never throws, so this branch is real whenever the mail provider is having a
 * bad afternoon or the API key is missing.
 *
 * What it asks the owner to do is the only thing left that a person can do: tell them.
 * The access itself needs nothing — the panel is simply there on their next page load.
 */
export const APPROVE_NOT_EMAILED =
  'They could not be emailed about it, so nobody has told them yet — let them know the admin panel is open to them. They do not have to do anything: the access is already on their account.'

/**
 * The same success, with the sentence about the email taken out. Two constants rather
 * than one plus an appendix, because the alternative is a success message that says "we
 * have emailed them" directly above a warning saying we could not.
 */
export const APPROVE_DONE_UNSENT =
  'Approved. That account is now an admin with full access to every listing — they can open the admin panel straight away, and their name is in the access record below.'

/** Shared by both decisions: the row is not there at all any more. */
export const DECISION_GONE =
  'That invitation is no longer there. Reload the page to see what is actually waiting.'

/** Shared by both decisions: somebody got to it first, in either direction. */
export const DECISION_STALE =
  'That invitation has already been dealt with — it was approved or cancelled since this page was drawn. Reload the page to see the current queue.'

export const APPROVE_EXPIRED =
  'That invitation has expired, so it cannot be approved. Nothing was changed. Send an invitation to the same address again to start over.'

export const APPROVE_UNCONFIRMED =
  'That address has not confirmed an account yet, so there is nobody to approve. Nothing was changed. It comes back to this list once they have created an account and entered their code.'

/**
 * Two accounts on one address. Reachable only where SSO is enabled — Supabase exempts SSO
 * users from the `auth.users` email uniqueness index — and the database refuses to guess
 * which of them the invitation meant rather than promoting an arbitrary one.
 *
 * It is reported as `unexpected` rather than as a conflict on purpose: this is not a race
 * the owner can resolve by reloading, it is a state somebody has to go and look at.
 */
export const APPROVE_AMBIGUOUS =
  'More than one account uses that email address, so approving would be a guess. Nothing was changed. This one needs looking at in the database before anybody is approved.'

export const APPROVE_ALREADY_ADMIN =
  'That account is already an owner, so there is nothing to grant and nothing was changed. Cancel the invitation instead.'

/**
 * A status this build does not know. Reported as a failure, never as a success: claiming
 * "approved" for an answer we cannot read would tell the owner that somebody has admin
 * access when nothing here knows whether they do.
 */
export const DECISION_UNREADABLE =
  'The database gave an answer this page does not recognise, so nothing is being claimed either way. Reload the page and check the list before trying again.'

/**
 * `delivered` is only consulted on the 'approved' branch, and it defaults to true so the
 * other six answers — none of which sends anything — cannot accidentally grow a warning
 * about an email that was never attempted.
 */
export function describeApproveOutcome(
  status: string | null | undefined,
  delivered = true
): ActionResult {
  switch (status as ApproveOutcome) {
    case 'approved':
      return delivered
        ? { ok: true, message: APPROVE_DONE }
        : { ok: true, message: APPROVE_DONE_UNSENT, warning: APPROVE_NOT_EMAILED }
    case 'not_found':
      return { ok: false, code: 'not_found', message: DECISION_GONE }
    case 'not_pending':
      return { ok: false, code: 'conflict', message: DECISION_STALE }
    case 'expired':
      return { ok: false, code: 'precondition', message: APPROVE_EXPIRED }
    case 'unconfirmed':
      return { ok: false, code: 'precondition', message: APPROVE_UNCONFIRMED }
    case 'ambiguous':
      return { ok: false, code: 'unexpected', message: APPROVE_AMBIGUOUS }
    case 'already_admin':
      return { ok: false, code: 'conflict', message: APPROVE_ALREADY_ADMIN }
    default:
      return { ok: false, code: 'unexpected', message: DECISION_UNREADABLE }
  }
}

export type DeclineOutcome = 'declined' | 'not_pending' | 'not_found'

/**
 * Cancelling says plainly that nothing was granted, because the whole reason the owner is
 * pressing it is usually that they typed the wrong address and want to know it is dead.
 */
export const DECLINE_DONE =
  'Invitation cancelled. The link in that email no longer works and nothing has been granted. The cancellation is recorded against the invitation.'

export function describeDeclineOutcome(status: string | null | undefined): ActionResult {
  switch (status as DeclineOutcome) {
    case 'declined':
      return { ok: true, message: DECLINE_DONE }
    case 'not_pending':
      return { ok: false, code: 'conflict', message: DECISION_STALE }
    case 'not_found':
      return { ok: false, code: 'not_found', message: DECISION_GONE }
    default:
      return { ok: false, code: 'unexpected', message: DECISION_UNREADABLE }
  }
}
