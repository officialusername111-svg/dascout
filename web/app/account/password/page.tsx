import type { Metadata } from 'next'
import Link from 'next/link'
import { hasRecentRecovery, requireAccountUser } from '@/lib/account/auth'
import { createClient } from '@/lib/supabase/server'
import { ChangePasswordForm, ResetPasswordForm } from '@/components/account/PasswordForms'

export const metadata: Metadata = { title: 'Password' }

/**
 * One screen, two forms, and the server decides which.
 *
 * Somebody who has just clicked a reset link cannot be asked for their current password —
 * not knowing it is why they are here. Everyone else must be asked, because Supabase does
 * not require the old password to set a new one, so without that check a stolen session
 * cookie is a silent account takeover.
 *
 * The condition is read from the session's own `amr` claim: signed in through a recovery
 * link within the last fifteen minutes. `?reset=1` in the address changes nothing at all
 * — it is what the callback puts there, and this page ignores it. The action re-checks the
 * same claim, so even if this page rendered the wrong form, the two-field one would be
 * refused.
 *
 * This screen is for every role. Staff and admins change their password here too, which
 * is why the way back is theirs and not always the buyer's.
 */
export default async function AccountPasswordPage() {
  const user = await requireAccountUser()
  const supabase = await createClient()
  const recovering = await hasRecentRecovery(supabase)

  const isStaff = user.role === 'staff' || user.role === 'admin'
  const backHref = isStaff ? '/admin' : '/account'
  const backLabel = isStaff ? 'Back to the admin' : 'Back to your account'

  return (
    <>
      <h1 style={{ fontSize: 'clamp(23px, 3vw, 31px)', margin: '26px 0 4px' }}>
        {recovering ? 'Set a new password' : 'Change your password'}
      </h1>
      <p className="amuted" style={{ marginBottom: 20 }}>
        {user.email ?? 'Your account'} · <Link href={backHref}>{backLabel}</Link>
      </p>

      <section className="apanel" style={{ maxWidth: 520 }}>
        {recovering ? (
          <>
            <h2>You came from a reset link</h2>
            <p className="sub2">
              Choose a new password. We are not asking for your old one, because you arrived through
              a link we sent to your email address in the last few minutes.
            </p>
            <ResetPasswordForm />
          </>
        ) : (
          <>
            <h2>Change your password</h2>
            <p className="sub2">
              Your current password is required. If you have forgotten it, sign out and use
              &ldquo;Forgot password?&rdquo; on the sign-in form instead.
            </p>
            <ChangePasswordForm />
          </>
        )}
      </section>
    </>
  )
}
