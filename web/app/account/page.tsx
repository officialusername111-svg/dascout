import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAccountUser } from '@/lib/account/auth'
import { SignOutButton } from '@/components/account/SignOutButton'

export const metadata: Metadata = { title: 'Overview' }

const ROLE_LABELS: Record<string, string> = {
  buyer: 'Buyer',
  broker: 'Broker',
  staff: 'Staff',
  admin: 'Administrator',
}

/**
 * The account's front door: who you are, the way out, and the three things you can do.
 *
 * Sign-out lives here rather than in the header on purpose. The header carries one
 * Account link and nothing else, which keeps the public chrome the shape the approved
 * mockup drew it, and puts the destructive control on a page somebody arrived at
 * deliberately instead of one tap from every listing.
 */
export default async function AccountOverviewPage() {
  const user = await requireAccountUser()
  const isStaff = user.role === 'staff' || user.role === 'admin'

  return (
    <>
      <h1 style={{ fontSize: 'clamp(23px, 3vw, 31px)', margin: '26px 0 4px' }}>Your account</h1>
      <p className="amuted" style={{ marginBottom: 20 }}>
        Saved properties, browsing history and your password.
      </p>

      <section className="apanel">
        <h2>{user.fullName ?? 'Your account'}</h2>
        <p className="sub2">
          {user.email ?? 'No email address on this account'} ·{' '}
          <span className="pill muted">{ROLE_LABELS[user.role] ?? user.role}</span>
        </p>
        <SignOutButton />
      </section>

      <section className="apanel">
        <h2>Saved properties</h2>
        <p className="sub2">
          Every property you have tapped the heart on, on any device you have signed in from.
        </p>
        <Link className="btn btn-navy abtn-sm" href="/account/favorites">
          Open saved properties
        </Link>
      </section>

      <section className="apanel">
        <h2>Browsing history</h2>
        <p className="sub2">
          What you have looked at recently, and the control that clears it from your account.
        </p>
        <Link className="btn btn-navy abtn-sm" href="/account/history">
          Open browsing history
        </Link>
      </section>

      <section className="apanel">
        <h2>Password</h2>
        <p className="sub2">
          Change your password. Doing so signs out every other device you are signed in on.
        </p>
        <Link className="btn btn-navy abtn-sm" href="/account/password">
          Change password
        </Link>
      </section>

      {isStaff && (
        <section className="apanel">
          <h2>Staff tools</h2>
          <p className="sub2">
            Your account is a {ROLE_LABELS[user.role]?.toLowerCase()} account, so the listings admin
            is open to you as well.
          </p>
          <Link className="btn btn-ghost abtn-sm" href="/admin">
            Open the admin
          </Link>
        </section>
      )}
    </>
  )
}
