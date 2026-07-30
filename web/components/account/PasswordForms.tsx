'use client'

import { useActionState, useState } from 'react'
import { changePassword, resetPassword } from '@/app/account/actions'
import type { ActionResult } from '@/app/admin/actions'

/**
 * The two password forms. Which one a person sees is decided on the SERVER, by
 * `/account/password` reading the session's `amr` claim — never by a query string and
 * never here. This file only draws them.
 *
 * Three fields when you know your current password, two when you have just come through
 * a verified reset link. The action re-checks the same condition, so rendering the
 * two-field version to somebody who should have the three-field one would achieve
 * nothing: `resetPassword` refuses a session that did not arrive through recovery.
 */

function Outcome({ state }: { state: ActionResult | null }) {
  if (!state) return null

  if (state.ok) {
    return (
      <div className="fmsg ok" role="status">
        {state.message}
        {state.warning ? ` ${state.warning}` : ''}
      </div>
    )
  }

  return (
    <div className="fmsg err" role="alert">
      {state.message}
    </div>
  )
}

function PasswordField({
  id,
  name,
  label,
  autoComplete,
  hint,
  error,
  minLength,
}: {
  id: string
  name: string
  label: string
  autoComplete: string
  hint?: string
  error?: string
  minLength?: number
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="pwwrap">
        <input
          id={id}
          name={name}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          minLength={minLength}
        />
        <button
          type="button"
          className="pwtoggle"
          aria-label={shown ? 'Hide password' : 'Show password'}
          onClick={() => setShown((value) => !value)}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && <div className="hint">{hint}</div>}
      <div className="ferr">{error ?? 'Password must be at least 8 characters.'}</div>
    </div>
  )
}

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, null)

  const failure = state && !state.ok ? state : null
  const fieldErrors = failure?.fieldErrors ?? {}

  return (
    <form action={formAction} noValidate>
      <Outcome state={state} />

      <PasswordField
        id="pw-current"
        name="currentPassword"
        label="Current password"
        autoComplete="current-password"
        error={fieldErrors.currentPassword}
        minLength={1}
      />

      <PasswordField
        id="pw-new"
        name="newPassword"
        label="New password"
        autoComplete="new-password"
        hint="At least 8 characters."
        error={fieldErrors.newPassword}
        minLength={8}
      />

      <PasswordField
        id="pw-confirm"
        name="confirmPassword"
        label="Repeat the new password"
        autoComplete="new-password"
        error={fieldErrors.confirmPassword}
        minLength={8}
      />

      <button className="mbtn" type="submit" disabled={pending}>
        {pending ? 'Changing password…' : 'Change password'}
      </button>

      <p className="amuted" style={{ marginTop: 12 }}>
        Changing your password signs out every other device you are signed in on. This one stays
        signed in.
      </p>
    </form>
  )
}

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(resetPassword, null)

  const failure = state && !state.ok ? state : null
  const fieldErrors = failure?.fieldErrors ?? {}

  return (
    <form action={formAction} noValidate>
      <Outcome state={state} />

      <PasswordField
        id="pw-new"
        name="newPassword"
        label="New password"
        autoComplete="new-password"
        hint="At least 8 characters."
        error={fieldErrors.newPassword}
        minLength={8}
      />

      <PasswordField
        id="pw-confirm"
        name="confirmPassword"
        label="Repeat the new password"
        autoComplete="new-password"
        error={fieldErrors.confirmPassword}
        minLength={8}
      />

      <button className="mbtn" type="submit" disabled={pending}>
        {pending ? 'Setting password…' : 'Set new password'}
      </button>

      <p className="amuted" style={{ marginTop: 12 }}>
        Setting a new password signs out every other device. The reset link works for fifteen
        minutes after you open it — if it has expired, request a new one from &ldquo;Forgot
        password&rdquo;.
      </p>
    </form>
  )
}
