'use client'

import { signOutAccount } from '@/app/account/actions'
import { applyAccountSignOut } from '@/components/ui-state'

/**
 * Sign out, in that order: this browser first, then the session.
 *
 * The local step has to run before the form submits, because the action ends in a
 * redirect and this component will not exist afterwards. It removes everything that came
 * off the account — the mirrored favourites, the browsing history, the marker — and keeps
 * the favourites this browser saved on its own. On a shared machine the next person
 * inherits nothing of the last person's account; on a personal machine nothing the
 * visitor saved before signing in is taken away from them.
 *
 * `onClick` on the submit button runs before the submission React then performs, which is
 * what makes the ordering reliable without intercepting the event.
 */
export function SignOutButton({ className = 'btn btn-ghost' }: { className?: string }) {
  return (
    <form action={signOutAccount}>
      <button className={className} type="submit" onClick={() => applyAccountSignOut()}>
        Sign out
      </button>
    </form>
  )
}
