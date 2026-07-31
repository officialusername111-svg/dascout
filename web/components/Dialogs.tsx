'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { useUI } from '@/components/ui-state'
import { ForgotPanel, RegisterPanel, SignInPanel } from '@/components/account/AuthPanels'
import { submitPropertyRequest } from '@/app/actions'
import type { ActionResult } from '@/app/admin/actions'
import { CATEGORIES, CATEGORY_KEYS } from '@/lib/categories'

/**
 * The two dialogs from the approved mockup.
 *
 * The auth dialog is now real: the shell — the dialog element, the tab pair, the close
 * button, the heading — stays here, and each tab's body is a form in
 * `components/account/AuthPanels.tsx` that posts to a server action. Nothing about the
 * markup or the classes changed; the placeholder that said accounts were not switched on
 * yet is gone, along with the "Remember me" checkbox (Supabase sessions are always
 * persistent, so a control that did nothing was a false promise).
 *
 * The request dialog is now real too. It keeps its own `validate()` pass so a missing
 * email is caught without a round trip, but nothing about the OUTCOME is decided here —
 * the sentence the visitor reads is the server's, always the same one, and it echoes
 * nothing they typed.
 */

/** Marks the fields the browser rejects, and returns the first one so it can take focus. */
function validate(form: HTMLFormElement): HTMLElement | null {
  let firstBad: HTMLElement | null = null
  form.querySelectorAll<HTMLElement>('.field').forEach((field) => {
    const input = field.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input, select, textarea'
    )
    if (!input) return
    const bad = !input.checkValidity()
    field.classList.toggle('invalid', bad)
    input.setAttribute('aria-invalid', String(bad))
    if (bad && !firstBad) firstBad = input
  })
  return firstBad
}

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
    document.body.classList.toggle('dialog-open', open)
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const handleClose = () => onClose()
    const handleClick = (event: MouseEvent) => {
      if (event.target === dialog) dialog.close()
    }
    dialog.addEventListener('close', handleClose)
    dialog.addEventListener('click', handleClick)
    return () => {
      dialog.removeEventListener('close', handleClose)
      dialog.removeEventListener('click', handleClick)
      document.body.classList.remove('dialog-open')
    }
  }, [onClose])

  return ref
}

export function AuthDialog() {
  const { authTab, openAuth, closeAuth } = useUI()
  const ref = useDialog(authTab !== null, closeAuth)
  const tab = authTab ?? 'login'

  return (
    <dialog ref={ref} aria-labelledby="authH">
      <div className="mbox">
        <button className="x" aria-label="Close" onClick={closeAuth}>
          <Icon name="x" />
        </button>
        <h3 id="authH">Welcome to DaScout</h3>
        <div className="sub2">Save favorites and follow verified listings.</div>

        <div className="mtabs" role="group" aria-label="Sign in or create account">
          <button aria-pressed={tab === 'login' || tab === 'forgot'} onClick={() => openAuth('login')}>
            Sign In
          </button>
          <button aria-pressed={tab === 'register'} onClick={() => openAuth('register')}>
            Create Account
          </button>
        </div>

        {tab === 'login' && <SignInPanel />}
        {tab === 'register' && <RegisterPanel />}
        {tab === 'forgot' && <ForgotPanel />}
      </div>
    </dialog>
  )
}

export function RequestDialog({ towns }: { towns: string[] }) {
  const { requestOpen, closeRequest } = useUI()
  const ref = useDialog(requestOpen, closeRequest)
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    submitPropertyRequest,
    null
  )
  const [clientError, setClientError] = useState<string | null>(null)
  const [shownWhileOpen, setShownWhileOpen] = useState(requestOpen)
  /** The answer the visitor has already read and closed the dialog on. */
  const [dismissed, setDismissed] = useState<ActionResult | null>(null)

  // Closing the dialog clears the previous answer. The server result cannot be unset —
  // `useActionState` owns it — so it is remembered as read instead, and a NEW result
  // (a different object) shows again.
  if (requestOpen !== shownWhileOpen) {
    setShownWhileOpen(requestOpen)
    if (!requestOpen) {
      setClientError(null)
      setDismissed(state)
    }
  }

  const failure = state && !state.ok ? state : null
  const fieldErrors = failure?.fieldErrors ?? {}
  const values = failure?.values ?? {}
  const outcome = state && state !== dismissed ? state : null

  /**
   * The browser's own check first, so an empty email costs nothing. `preventDefault`
   * stops React from running the server action; without it the form would post anyway.
   */
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    const firstBad = validate(event.currentTarget)
    if (firstBad) {
      event.preventDefault()
      setClientError('Please fix the highlighted fields.')
      firstBad.focus()
      return
    }
    setClientError(null)
    setDismissed(null)
  }

  return (
    <dialog ref={ref} aria-labelledby="reqDH">
      <div className="mbox">
        <button className="x" aria-label="Close" onClick={closeRequest}>
          <Icon name="x" />
        </button>
        <h3 id="reqDH">Can&rsquo;t find it? Request it.</h3>
        <div className="sub2">
          Tell us what you&rsquo;re looking for and we&rsquo;ll notify you when a matching listing
          goes live.
        </div>

        {clientError ? (
          <div className="fmsg err" role="alert">
            {clientError}
          </div>
        ) : outcome ? (
          <div className={`fmsg ${outcome.ok ? 'ok' : 'err'}`} role={outcome.ok ? 'status' : 'alert'}>
            {outcome.message}
          </div>
        ) : null}

        <form noValidate action={formAction} onSubmit={submit}>
          <div className={`field${fieldErrors.category ? ' invalid' : ''}`}>
            <label htmlFor="rq-type">Property type</label>
            <select id="rq-type" name="category" defaultValue={values.category ?? 'rlot'}>
              {CATEGORY_KEYS.map((key) => (
                <option key={key} value={key}>
                  {CATEGORIES[key].label}
                </option>
              ))}
            </select>
            <div className="ferr">
              {fieldErrors.category ?? 'Choose one of the five property types.'}
            </div>
          </div>
          <div className={`field${fieldErrors.preferred_town ? ' invalid' : ''}`}>
            <label htmlFor="rq-loc">Preferred location</label>
            <input
              id="rq-loc"
              name="preferred_town"
              type="text"
              placeholder="e.g. Polomolok, South Cotabato"
              list="requestTownList"
              autoComplete="off"
              maxLength={120}
              required
              defaultValue={values.preferred_town ?? ''}
            />
            <div className="ferr">
              {fieldErrors.preferred_town ?? 'Tell us where you’re looking.'}
            </div>
          </div>
          <div className={`field${fieldErrors.budget ? ' invalid' : ''}`}>
            <label htmlFor="rq-budget">
              Budget <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>(optional)</span>
            </label>
            <input
              id="rq-budget"
              name="budget"
              type="text"
              placeholder="e.g. ₱2M – ₱6M"
              maxLength={40}
              defaultValue={values.budget ?? ''}
            />
            <div className="ferr">
              {fieldErrors.budget ?? 'Try something like “2M – 6M”, “5M” or “2M+”.'}
            </div>
          </div>
          <div className={`field${fieldErrors.notes ? ' invalid' : ''}`}>
            <label htmlFor="rq-notes">
              Details <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>(optional)</span>
            </label>
            <textarea
              id="rq-notes"
              name="notes"
              rows={3}
              maxLength={2000}
              placeholder="Lot size, must-have features, timeline…"
              defaultValue={values.notes ?? ''}
            />
            <div className="ferr">
              {fieldErrors.notes ?? 'Keep the details under 2000 characters.'}
            </div>
          </div>
          <div className={`field${fieldErrors.email ? ' invalid' : ''}`}>
            <label htmlFor="rq-email">Your email</label>
            <input
              id="rq-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              required
              defaultValue={values.email ?? ''}
            />
            <div className="ferr">
              {fieldErrors.email ?? 'Enter a valid email so we can notify you.'}
            </div>
          </div>
          <button className="mbtn" type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Submit Request'}
          </button>
        </form>

        <datalist id="requestTownList">
          {towns.map((town) => (
            <option key={town} value={town} />
          ))}
        </datalist>
      </div>
    </dialog>
  )
}
