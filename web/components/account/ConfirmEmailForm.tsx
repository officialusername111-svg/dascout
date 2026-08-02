'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { verifyAccountEmailCode } from '@/app/account/actions'
import { OTP_CODE_LENGTH } from '@/lib/account/otp'

/**
 * The code box, and the "you are done" panel that replaces it.
 *
 * Two screens, one component and no navigation between them. The action that verifies the
 * code is also the action that creates the session, so a redirect after it would be a
 * second request to prove something this one already knows — and a failed redirect would
 * strand somebody who IS confirmed on a page telling them to confirm. When the action
 * comes back `ok`, this renders the second panel in place.
 *
 * WHAT THE SECOND PANEL IS FOR. An invitee who confirms their address is NOT an admin: a
 * person has to approve them, and that can take a while. Without a screen that says so,
 * the flow ends in silence — they type a code, the box disappears, nothing else happens,
 * and the next thing that occurs is an email to the owner asking whether it is broken.
 * That sentence is the whole reason this panel exists.
 *
 * `invited` chooses which version of "what happens next" is shown and authorises nothing
 * whatsoever — it is a query flag, the same standing as `?reset=1` on the password page.
 * A visitor who sets it by hand sees different words and gets no access of any kind.
 *
 * The address is a real field rather than a line of copy, and it is TYPED rather than
 * pre-filled from the URL. This page has no session to read it from — the whole point is
 * that the account is not confirmed yet — and the code is meaningless without the address
 * it was sent to. Passing it in a query string was considered and refused: a query string
 * is written into Vercel's access log for every request and handed onward by `Referer`,
 * which is the same reason the invitation link carries no address either. The person has
 * the address in front of them in the email they are reading the code from.
 */
export function ConfirmEmailForm({ invited }: { invited: boolean }) {
  // Inferred rather than annotated, exactly as the sign-up panel does it: the action's own
  // return type carries the account bootstrap, and restating it here as
  // `ActionResult<unknown>` would be a wider type than the action promises.
  const [state, formAction, pending] = useActionState(verifyAccountEmailCode, null)

  const failure = state && !state.ok ? state : null
  const fieldErrors = failure?.fieldErrors ?? {}
  const values = failure?.values ?? {}

  if (state?.ok) {
    return (
      <div className="apanel">
        <h2>Thanks — you&rsquo;re all set</h2>
        {invited ? (
          <>
            <p className="sub2">
              Your email is confirmed, and your invitation is now with the DaScout owner
              for approval. You will be able to manage listings once they approve it, and
              we will email you when they do.
            </p>
            <p className="sub2">
              Nothing more is needed from you. Approving is something a person does, so it
              may take a little while.
            </p>
          </>
        ) : (
          <p className="sub2">
            Your email is confirmed and you are signed in. Your saved properties and your
            browsing history are kept on your account from here on.
          </p>
        )}
        <Link className="btn btn-ghost" href="/">
          Browse properties
        </Link>
      </div>
    )
  }

  return (
    <form className="apanel" action={formAction} noValidate>
      <h2>Check your email</h2>
      <p className="sub2">
        We sent a {OTP_CODE_LENGTH}-digit code to the address you signed up with. Enter it
        below to confirm the address is yours.
      </p>

      {failure && !fieldErrors.code && !fieldErrors.email && (
        <div className="fmsg err" role="alert">
          {failure.message}
        </div>
      )}

      <div className={`field${fieldErrors.email ? ' invalid' : ''}`}>
        <label htmlFor="cf-email">Email address</label>
        <input
          id="cf-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          defaultValue={values.email ?? ''}
        />
        <div className="ferr">{fieldErrors.email ?? 'Enter a valid email address.'}</div>
      </div>

      <div className={`field${fieldErrors.code ? ' invalid' : ''}`}>
        <label htmlFor="cf-code">{OTP_CODE_LENGTH}-digit code</label>
        {/*
          `one-time-code` is what lets a phone offer the code straight from the message,
          and `inputMode="numeric"` gives a number pad without making this a `type=number`
          field — which would strip a leading zero and add stepper arrows to a code.
          `maxLength` is 8 rather than 6 so a pasted "123 456" is not silently truncated
          to "123 45"; the schema strips the spaces on the way in.
        */}
        <input
          id="cf-code"
          className="otp"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          required
          aria-describedby="cf-code-hint"
        />
        <div className="hint" id="cf-code-hint">
          The code can be used once and expires in about an hour.
        </div>
        <div className="ferr">
          {fieldErrors.code ?? `Enter the ${OTP_CODE_LENGTH}-digit code from the email.`}
        </div>
      </div>

      <button className="mbtn" type="submit" disabled={pending}>
        {pending ? 'Confirming…' : 'Confirm my email'}
      </button>

      {/*
        No "send a new code" button. Asking for one is a public endpoint that makes this
        site send mail to any address somebody types, and building that is a decision with
        its own threat model rather than a detail of this screen. The instruction below is
        true today and needs nothing new: signing up again on the same unconfirmed address
        makes Supabase send a fresh code.
      */}
      <p className="amuted" style={{ marginTop: 14, textAlign: 'center' }}>
        Nothing arrived? Check your spam folder. You can also create the account again on
        the same address and we will send a new code.
      </p>
    </form>
  )
}
