import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { getAccountIdentity } from '@/lib/account/auth'
import { INVITE_COOKIE } from '@/lib/admin/invites'
import { acceptAdminInvite } from '../actions'

/**
 * Where an invitee lands after the route handler has taken the token out of the URL.
 *
 * It sits under `app/admin/` and deliberately NOT under `app/admin/(staff)/`: that route
 * group's layout calls `requireStaff()`, and an invitee is not staff yet — the guard
 * would bounce every single person this page exists for straight to the sign-in form.
 * The parent `app/admin/layout.tsx` is metadata only and already marks the whole segment
 * noindex, which is why there is no `robots` key here.
 *
 * Two things this page must not do, both of them the reason the flow is shaped like it
 * is. It must not accept anything on GET — a mail scanner fetches every URL in a message
 * — so the acceptance is a POST behind a button. And it must not explain WHY an
 * invitation failed: the database collapses six different reasons into the single word
 * 'invalid' so this endpoint cannot be used to work out which tokens exist, and
 * re-expanding them here would hand back exactly what that design gives up.
 *
 * The one thing it may safely say is who the visitor themselves is, read from their own
 * session. "You are signed in as X" is a fact they already have; it is not a fact about
 * the invitation, and it is the single most useful sentence on the page, because signing
 * in on the wrong address is the failure people actually hit.
 */

export const metadata: Metadata = { title: 'Accept invitation' }

type Search = Record<string, string | string[] | undefined>

function flag(value: string | string[] | undefined): boolean {
  return (Array.isArray(value) ? value[0] : value) === '1'
}

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const params = await searchParams
  const done = flag(params.done)
  const failed = flag(params.failed)

  const identity = await getAccountIdentity()
  const signedInAs = identity.state === 'signed-in' ? identity.user.email : null

  // Whether the link is still in hand. This is our own cookie and nothing else — it says
  // nothing about whether any token is real, only whether this browser has one to try.
  const jar = await cookies()
  const holdsLink = jar.has(INVITE_COOKIE)

  return (
    <main id="main" className="asignin">
      <h1>DaScout Admin</h1>

      {done ? (
        <div className="apanel">
          <h2>Invitation accepted</h2>
          <p className="sub2">
            Your account can now manage listings. The admin panel is the place to work
            from.
          </p>
          <Link className="btn btn-dark" href="/admin">
            Open the admin panel
          </Link>
        </div>
      ) : failed ? (
        <div className="apanel">
          <h2>That invitation could not be used</h2>
          <p className="sub2">
            An invitation works once, expires after seven days, and only for the email
            address it was sent to.
          </p>
          {signedInAs ? (
            <p className="sub2">
              You are signed in as <b>{signedInAs}</b>. If the invitation was sent to a
              different address, sign out and sign in with that one, then open the link in
              the invitation email again. If the address is right, ask whoever invited you
              to send a fresh invitation.
            </p>
          ) : (
            <p className="sub2">
              You are not signed in. Sign in with the address the invitation was sent to,
              then open the link in the invitation email again.
            </p>
          )}
          <p className="amuted">
            Accepting also needs a confirmed email address — if you have just created your
            account, open the &ldquo;Confirm your email&rdquo; message we sent you first.
          </p>
        </div>
      ) : !signedInAs ? (
        <div className="apanel">
          <h2>Sign in to accept this invitation</h2>
          <p className="sub2">
            Sign in with the email address this invitation was sent to, or create an
            account with that same address, and then come back to this page.
          </p>
          <p className="sub2">
            A brand-new account gets one more email from us — &ldquo;Confirm your
            email&rdquo;. Open that one before you come back: an unconfirmed address
            cannot accept an invitation.
          </p>
          <div className="aactions">
            {/* The PUBLIC sign-in dialog, not /admin/sign-in — that door signs out any
                caller who is not already staff, which is every invitee. */}
            <Link className="btn btn-dark" href="/?auth=login">
              Sign in
            </Link>
            <Link className="btn btn-ghost" href="/?auth=register">
              Create an account
            </Link>
          </div>
        </div>
      ) : holdsLink ? (
        <div className="apanel">
          <h2>Accept this invitation?</h2>
          <p className="sub2">
            You are signed in as <b>{signedInAs}</b>. Accepting gives this account access
            to the DaScout admin panel, where listings are created, verified and
            published.
          </p>
          <p className="sub2">
            If that is not the address the invitation was sent to, sign out first and sign
            in with the right one — an invitation only works for its own address.
          </p>
          <form action={acceptAdminInvite}>
            <button className="btn btn-dark" type="submit">
              Accept invitation
            </button>
          </form>
        </div>
      ) : (
        <div className="apanel">
          <h2>Open the invitation link again</h2>
          <p className="sub2">
            You are signed in as <b>{signedInAs}</b>, but this page no longer has an
            invitation to accept — the link is held for fifteen minutes after it is
            opened. Open the link in the invitation email again to carry on.
          </p>
        </div>
      )}
    </main>
  )
}
