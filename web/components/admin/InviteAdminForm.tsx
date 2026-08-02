'use client'

import { useActionState } from 'react'
import { inviteAdmin, type ActionResult } from '@/app/admin/actions'

/**
 * The one control that can create an admin account.
 *
 * Nothing about the outcome is decided here. The browser sends an address; the server
 * decides whether the caller may invite, the database mints the secret, and this
 * component renders whichever sentence comes back. In particular the invitation token is
 * never part of that answer — a server action's result is serialised into the page, so a
 * token in it would be readable in the page source.
 *
 * `pending` disables the button, which is the cheapest guard against the double submit
 * that would otherwise race two invitations for one address into the database's partial
 * unique index.
 */
export function InviteAdminForm() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    inviteAdmin,
    null
  )

  const failure = state && !state.ok ? state : null
  const emailError = failure?.fieldErrors?.email

  return (
    <form action={formAction} className="apanel">
      <h2>Invite an admin</h2>
      <p className="sub2">
        Sends an invitation to this address. It grants nothing on its own — the person
        creates an account, confirms their email with a code, and then appears below for
        you to approve. Approving gives them full access to listings — creating, editing,
        publishing and deleting any of them — but not the ability to invite or remove
        other admins.
      </p>

      {state?.ok && state.message && (
        <div className="fmsg ok" role="status">
          {state.message}
        </div>
      )}
      {failure && !emailError && (
        <div className="fmsg err" role="alert">
          {failure.message}
        </div>
      )}

      <div className={`field${emailError ? ' invalid' : ''}`}>
        <label htmlFor="invite-email">Email address</label>
        <input
          id="invite-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          required
          defaultValue={failure?.values?.email ?? ''}
        />
        <div className="hint">
          The invitation expires in seven days. Somebody who has no DaScout account yet
          gets a second email with a 6-digit code to confirm the address — until they
          enter it, their invitation sits below as &ldquo;not signed up&rdquo; and cannot
          be approved.
        </div>
        <div className="ferr">{emailError ?? 'Enter the address to invite.'}</div>
      </div>

      <div className="aactions">
        <button className="btn btn-dark" type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Send invitation'}
        </button>
        <span className="amuted">
          Inviting the same address again cancels the earlier invitation and sends a fresh
          one.
        </span>
      </div>
    </form>
  )
}
