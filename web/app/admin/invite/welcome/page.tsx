import type { Metadata } from 'next'
import Link from 'next/link'
import { getAccountIdentity } from '@/lib/account/auth'
import { isStaffRole } from '@/lib/admin/auth'

/**
 * Where an invitee lands, and the only thing an invitation email links to.
 *
 * IT OFFERS NO ACTION, BECAUSE THERE IS NO ACTION LEFT TO OFFER. This page used to be
 * `/admin/invite/accept` and its centrepiece was an "Accept invitation" button that
 * promoted the caller on the spot. That door was retired on the owner's decision
 * (run-p9): approval by the super admin is now the only way any account gets admin
 * access, and `redeem_admin_invite` is not callable by anybody. A button that would
 * always come back "that invitation could not be used" is worse than no button — it
 * reads as a bug, and the person it fails would write to the owner about it.
 *
 * So every state below ends in either a real, workable next step (create an account,
 * sign in, open the panel) or the plain statement that the invitation is with the owner.
 * None of them offers something that cannot succeed.
 *
 * It sits under `app/admin/` and deliberately NOT under `app/admin/(staff)/`: that route
 * group's layout calls `requireStaff()`, and an invitee is not staff — the guard would
 * bounce every single person this page exists for. The parent `app/admin/layout.tsx` is
 * metadata only and already marks the whole segment noindex.
 *
 * The one thing it may safely say is who the visitor themselves is, read from their own
 * session. "You are signed in as X" is a fact they already have, not a fact about any
 * invitation, and it is the most useful sentence on the page: signing in on the wrong
 * address is the failure people actually hit, and under this design a wrong address means
 * the owner simply never sees them.
 *
 * NOTHING HERE IS TOLD ANYTHING ABOUT AN INVITATION. There is no lookup, no token, no
 * "your invitation is valid" — `admin_invites` is readable only by a super admin, and it
 * must stay that way: a page that confirmed whether an address had a live invitation
 * would be an oracle anybody could query. The copy is therefore written to be true
 * whether or not the visitor was ever invited.
 */

export const metadata: Metadata = { title: 'Your invitation' }

export default async function InviteWelcomePage() {
  const identity = await getAccountIdentity()
  const signedInAs = identity.state === 'signed-in' ? identity.user.email : null
  const alreadyStaff = identity.state === 'signed-in' && isStaffRole(identity.user.role)

  return (
    <main id="main" className="asignin">
      <h1>DaScout Admin</h1>

      {alreadyStaff ? (
        /*
          Already has access — either they were approved while this tab sat open, or they
          opened an old link after the fact. The panel is the only useful thing to offer.
        */
        <div className="apanel">
          <h2>You already have access</h2>
          <p className="sub2">
            This account can manage listings. There is nothing here to accept — the admin
            panel is the place to work from.
          </p>
          <Link className="btn btn-dark" href="/admin">
            Open the admin panel
          </Link>
        </div>
      ) : !signedInAs ? (
        <div className="apanel">
          <h2>You have been invited to help manage listings</h2>
          <p className="sub2">
            Create a DaScout account using <b>the email address this invitation was sent
            to</b>. An invitation only works for its own address, so an account on a
            different one will not be matched to it.
          </p>
          <p className="sub2">
            We will then email you a 6-digit code to confirm the address. After you enter
            it, the DaScout owner approves your account — that is a person, not a machine,
            so it may take a little while. We will email you when it is done.
          </p>
          <div className="aactions">
            {/* The PUBLIC sign-in dialog, not /admin/sign-in — that door signs out any
                caller who is not already staff, which is every invitee. */}
            <Link className="btn btn-dark" href="/?auth=register">
              Create an account
            </Link>
            <Link className="btn btn-ghost" href="/?auth=login">
              I already have an account
            </Link>
          </div>
          <p className="amuted" style={{ marginTop: 14 }}>
            Nothing has been granted to anybody yet, and nothing you do on this page grants
            it.
          </p>
        </div>
      ) : (
        <div className="apanel">
          <h2>Your part is done</h2>
          <p className="sub2">
            You are signed in as <b>{signedInAs}</b>. If that is the address the invitation
            was sent to, it is now with the DaScout owner for approval — you will be able
            to manage listings once they approve it, and we will email you when they do.
          </p>
          <p className="sub2">
            Nothing more is needed from you. Approving is something a person does, so it
            may take a little while.
          </p>
          <p className="sub2">
            If your email address is not confirmed yet, finish that first — we sent a
            6-digit code when the account was created. <Link href="/confirm">Enter your
            code</Link>.
          </p>
          <p className="amuted">
            If this is not the address the invitation was sent to, sign out and sign in
            with that one. An invitation is matched to its own address and nothing else.
          </p>
        </div>
      )}
    </main>
  )
}
