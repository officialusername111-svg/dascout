'use client'

import { useActionState } from 'react'
import { demoteAdmin, type ActionResult } from '@/app/admin/actions'

/**
 * The one control on an admin row: take the access away.
 *
 * It is only rendered for a staff row that is not the caller's own — `canRemove` on the
 * query decides that server-side, so the button's absence is not a decision made in the
 * browser. It is also not the control: `revoke_staff_admin` refuses an `admin` target
 * and refuses the caller's own row whatever this form posts, which is what keeps "at
 * least one owner exists" true even against a hand-written request.
 *
 * The account survives the demotion as an ordinary buyer account. Nothing here deletes
 * a person.
 */
export function RemoveAdminButton({ profileId, email }: { profileId: string; email: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    demoteAdmin,
    null
  )

  const failure = state && !state.ok ? state : null

  return (
    <form action={formAction} className="aactions">
      <input type="hidden" name="profileId" value={profileId} />
      {/* Every row's button says the same three words, so the address goes in the
          accessible name — otherwise a screen reader reads a list of identical buttons. */}
      <button
        className="btn btn-ghost abtn-sm"
        type="submit"
        disabled={pending}
        aria-label={`Remove admin access from ${email}`}
      >
        {pending ? 'Removing…' : 'Remove admin access'}
      </button>
      {state?.ok && state.message && (
        <span className="fmsg ok" role="status">
          {state.message}
        </span>
      )}
      {failure && (
        <span className="fmsg err" role="alert">
          {failure.message}
        </span>
      )}
    </form>
  )
}
