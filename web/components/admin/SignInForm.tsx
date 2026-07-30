'use client'

import { useActionState } from 'react'
import { signIn, type ActionResult } from '@/app/admin/actions'

/**
 * Staff sign-in. The action either redirects or hands back a message; nothing about
 * the outcome is decided here, because the browser is not allowed to be the one that
 * decides whether a sign-in worked.
 *
 * `useActionState` starts at null so the form renders clean on first paint, and its
 * `pending` flag disables the button — the cheapest guard against a double submit.
 */
export function SignInForm({ denied }: { denied: boolean }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(signIn, null)

  const failure = state && !state.ok ? state : null
  const fieldErrors = failure?.fieldErrors ?? {}

  return (
    <form action={formAction} noValidate>
      {denied && !failure && (
        <div className="fmsg err" role="status">
          That account is not a staff account, so it cannot open the admin. Sign in with a staff
          account instead.
        </div>
      )}

      {failure && (
        <div className="fmsg err" role="alert">
          {failure.message}
        </div>
      )}

      <div className={`field${fieldErrors.email ? ' invalid' : ''}`}>
        <label htmlFor="admin-email">Email</label>
        <input
          id="admin-email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          defaultValue=""
        />
        <div className="ferr">{fieldErrors.email ?? 'Enter your work email address.'}</div>
      </div>

      <div className={`field${fieldErrors.password ? ' invalid' : ''}`}>
        <label htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <div className="ferr">{fieldErrors.password ?? 'Enter your password.'}</div>
      </div>

      <button className="mbtn" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign In'}
      </button>
    </form>
  )
}
