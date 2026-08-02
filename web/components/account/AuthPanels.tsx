'use client'

import { useActionState, useEffect, useState } from 'react'
import { requestPasswordReset, signInBuyer, signUpBuyer } from '@/app/account/actions'
import type { ActionResult } from '@/app/admin/actions'
import { callbackReasonCopy } from '@/lib/account/messages'
import { useUI } from '@/components/ui-state'

/**
 * The three bodies of the sign-in dialog. The shell — the dialog element, the tab pair,
 * the close button — stays in `Dialogs.tsx`; these are the forms inside it.
 *
 * Every one of them posts to a server action and renders whatever comes back. Nothing
 * about an outcome is decided here, because the browser is not allowed to be the thing
 * that decides whether a sign-in worked. The forms carry `noValidate` for the same reason
 * the admin's does: the server's message is the one that must be shown, so the browser's
 * own bubble is kept out of the way.
 *
 * These components may import the account actions, the shared message constants and
 * other components — and nothing else. Reaching for `lib/account/auth` or
 * `lib/supabase/server` from here would pull `next/headers` into a client bundle, which
 * Turbopack refuses outright.
 */

/** Shown when the sign-in dialog opened itself after a link failed to work. */
function ReasonBanner({ reason }: { reason: string | null }) {
  const copy = callbackReasonCopy(reason)
  if (!copy) return null
  return (
    <div className="fmsg err" role="alert">
      {copy}
    </div>
  )
}

function Outcome({ state }: { state: ActionResult<unknown> | null }) {
  if (!state) return null

  if (state.ok) {
    if (!state.message && !state.warning) return null
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

/** The show/hide password control from the approved mockup, with a real `name`. */
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

export function SignInPanel() {
  const { openAuth, closeAuth, authReason, toast } = useUI()
  const [state, formAction, pending] = useActionState(signInBuyer, null)

  const failure = state && !state.ok ? state : null
  const fieldErrors = failure?.fieldErrors ?? {}
  const values = failure?.values ?? {}

  /**
   * The dialog closes itself on success. It does not need to reload anything: writing
   * the session cookie in a server action makes Next re-render this page and its layouts
   * server-side, so the header already says "Account" by the time this runs, and
   * `AccountSync` picks up the merge from the new `userId`.
   */
  useEffect(() => {
    if (state?.ok) {
      closeAuth()
      toast('Signed in')
    }
  }, [state, closeAuth, toast])

  return (
    <form action={formAction} noValidate>
      <ReasonBanner reason={authReason} />
      {failure && !fieldErrors.password && !fieldErrors.email && <Outcome state={state} />}

      <div className={`field${fieldErrors.email ? ' invalid' : ''}`}>
        <label htmlFor="li-user">Email</label>
        <input
          id="li-user"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={values.email ?? ''}
        />
        <div className="ferr">{fieldErrors.email ?? 'Enter your email address.'}</div>
      </div>

      <PasswordField
        id="li-pass"
        name="password"
        label="Password"
        autoComplete="current-password"
        error={fieldErrors.password}
        minLength={1}
      />

      <button className="mbtn" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign In'}
      </button>

      <div className="mmeta">
        <button type="button" onClick={() => openAuth('forgot')}>
          Forgot password?
        </button>
      </div>
    </form>
  )
}

export function RegisterPanel() {
  const { closeAuth, authReason, toast } = useUI()
  const [state, formAction, pending] = useActionState(signUpBuyer, null)

  const failure = state && !state.ok ? state : null
  const fieldErrors = failure?.fieldErrors ?? {}
  const values = failure?.values ?? {}

  // A sign-up that came back with a session (email confirmation switched off) is a
  // sign-in; one that did not has to keep the "check your email" sentence on screen.
  useEffect(() => {
    if (state?.ok && state.data) {
      closeAuth()
      toast('Signed in')
    }
  }, [state, closeAuth, toast])

  return (
    <form action={formAction} noValidate>
      <ReasonBanner reason={authReason} />
      <Outcome state={state} />

      <div className={`field${fieldErrors.email ? ' invalid' : ''}`}>
        <label htmlFor="rg-email">Email</label>
        <input
          id="rg-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={values.email ?? ''}
        />
        <div className="ferr">{fieldErrors.email ?? 'Enter a valid email address.'}</div>
      </div>

      <div className={`field${fieldErrors.fullName ? ' invalid' : ''}`}>
        <label htmlFor="rg-user">Full name</label>
        <input
          id="rg-user"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          defaultValue={values.fullName ?? ''}
        />
        <div className="ferr">
          {fieldErrors.fullName ?? 'Enter the name you want on your account.'}
        </div>
      </div>

      <PasswordField
        id="rg-pass"
        name="password"
        label="Password"
        autoComplete="new-password"
        hint="At least 8 characters."
        error={fieldErrors.password}
        minLength={8}
      />

      <button className="mbtn" type="submit" disabled={pending}>
        {pending ? 'Creating account…' : 'Create Account'}
      </button>

      {/*
        The way to the code page. A sign-up that came back WITHOUT a session is the
        confirmation case, and the sentence above tells them a code is on its way — but a
        sentence is not a route, and the flow dead-ends here without this link.

        `state.data` is what tells the two apart: it is present only when a session came
        back (email confirmation switched off), and that case has already closed the
        dialog in the effect above.

        A plain `<a>` rather than `Link`, on purpose: this has to leave the dialog behind,
        and a client-side navigation would keep the open `<dialog>` mounted on top of the
        page it navigated to.
      */}
      {state?.ok && !state.data && (
        <a className="btn btn-ghost" href="/confirm" style={{ marginTop: 12, width: '100%' }}>
          Enter my code
        </a>
      )}

      {/*
        Said plainly, on the form, before anyone signs up rather than in a policy page
        nobody opens: once there is an account, what you look at is kept against it and
        DaScout staff can see it.
      */}
      <p className="amuted" style={{ marginTop: 12 }}>
        While you are signed in, the properties you view and save are stored on your account and
        are visible to DaScout staff. You can clear your browsing history from your account at any
        time.
      </p>
    </form>
  )
}

export function ForgotPanel() {
  const { openAuth, authReason } = useUI()
  const [state, formAction, pending] = useActionState(requestPasswordReset, null)

  const failure = state && !state.ok ? state : null
  const fieldErrors = failure?.fieldErrors ?? {}
  const values = failure?.values ?? {}

  return (
    <form action={formAction} noValidate>
      <ReasonBanner reason={authReason} />
      <Outcome state={state} />

      <div className={`field${fieldErrors.email ? ' invalid' : ''}`}>
        <label htmlFor="fg-email">Email</label>
        <input
          id="fg-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={values.email ?? ''}
        />
        <div className="ferr">{fieldErrors.email ?? 'Enter the email you registered with.'}</div>
      </div>

      <button className="mbtn" type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send Reset Link'}
      </button>

      <div className="mmeta">
        <button type="button" onClick={() => openAuth('login')}>
          Back to sign in
        </button>
      </div>
    </form>
  )
}
