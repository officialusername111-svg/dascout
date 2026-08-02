'use client'

import { useActionState } from 'react'
import {
  approveAdminInvite,
  declineAdminInvite,
  type ActionResult,
} from '@/app/admin/actions'

/**
 * The controls on one invitation row: approve it, or cancel it.
 *
 * TWO SEPARATE FORMS, NOT ONE FORM WITH TWO SUBMIT BUTTONS. A single form would post one
 * field that says which button was pressed, and the difference between "grant this person
 * admin access" and "throw this invitation away" would be a string in the payload. Two
 * forms means two server actions, each with its own name, its own guard and its own RPC —
 * there is nothing for a crafted POST to flip.
 *
 * Neither button is the decision. `approve_admin_invite` and `decline_admin_invite` are
 * SECURITY DEFINER functions that ask `is_super_admin()` themselves, re-read the
 * invitation under a row lock, and re-derive the account from the invitation's own
 * address. `canApprove` here only decides what is DRAWN: a stale "Approve" on an
 * invitation whose account has vanished answers 'unconfirmed' and writes nothing.
 *
 * `pending` disables both buttons on the row while either is in flight. Approving twice
 * is safe — the second call answers 'not_pending' — but a double-press that reads as
 * "nothing happened" is how somebody ends up pressing Decline next.
 */
export function CandidateActions({
  inviteId,
  email,
  canApprove,
}: {
  inviteId: string
  email: string
  canApprove: boolean
}) {
  const [approveState, approveAction, approving] = useActionState<ActionResult | null, FormData>(
    approveAdminInvite,
    null
  )
  const [declineState, declineAction, declining] = useActionState<ActionResult | null, FormData>(
    declineAdminInvite,
    null
  )

  const busy = approving || declining
  const state = approveState ?? declineState
  const failure = state && !state.ok ? state : null

  return (
    <div className="aactions">
      {canApprove && (
        <form action={approveAction}>
          <input type="hidden" name="inviteId" value={inviteId} />
          {/* Every row's button says the same word, so the address goes in the accessible
              name — otherwise a screen reader reads a list of identical buttons. */}
          <button
            className="btn btn-dark btn-sm"
            type="submit"
            disabled={busy}
            aria-label={`Approve admin access for ${email}`}
          >
            {approving ? 'Approving…' : 'Approve'}
          </button>
        </form>
      )}

      <form action={declineAction}>
        <input type="hidden" name="inviteId" value={inviteId} />
        <button
          className={canApprove ? 'btn btn-ghost btn-sm' : 'btn btn-quiet btn-sm'}
          type="submit"
          disabled={busy}
          aria-label={`Cancel the invitation to ${email}`}
        >
          {declining ? 'Cancelling…' : canApprove ? 'Decline' : 'Cancel invitation'}
        </button>
      </form>

      {state?.ok && state.message && (
        <span className="fmsg ok" role="status">
          {state.message}
          {state.warning ? ` ${state.warning}` : ''}
        </span>
      )}
      {failure && (
        <span className="fmsg err" role="alert">
          {failure.message}
        </span>
      )}
    </div>
  )
}
