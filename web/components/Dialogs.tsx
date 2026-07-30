'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { useUI } from '@/components/ui-state'
import { ForgotPanel, RegisterPanel, SignInPanel } from '@/components/account/AuthPanels'
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
 * Saved property requests (Phase 5) are still not wired, so that form validates properly
 * and then says plainly that the feature is not switched on — never a fake confirmation.
 */

const NOT_LIVE_REQUEST =
  'Requests are not switched on yet. Email hello@dascout.ph and our team will pick it up.'

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
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [shownWhileOpen, setShownWhileOpen] = useState(requestOpen)

  // Closing the dialog clears the previous answer.
  if (requestOpen !== shownWhileOpen) {
    setShownWhileOpen(requestOpen)
    if (!requestOpen) setMessage(null)
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const firstBad = validate(event.currentTarget)
    if (firstBad) {
      setMessage({ kind: 'err', text: 'Please fix the highlighted fields.' })
      firstBad.focus()
      return
    }
    setMessage({ kind: 'ok', text: NOT_LIVE_REQUEST })
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

        {message && (
          <div className={`fmsg ${message.kind}`} role="status">
            {message.text}
          </div>
        )}

        <form noValidate onSubmit={submit}>
          <div className="field">
            <label htmlFor="rq-type">Property type</label>
            <select id="rq-type" defaultValue="rlot">
              {CATEGORY_KEYS.map((key) => (
                <option key={key} value={key}>
                  {CATEGORIES[key].label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rq-loc">Preferred location</label>
            <input
              id="rq-loc"
              type="text"
              placeholder="e.g. Polomolok, South Cotabato"
              list="requestTownList"
              autoComplete="off"
              required
            />
            <div className="ferr">Tell us where you&rsquo;re looking.</div>
          </div>
          <div className="field">
            <label htmlFor="rq-budget">
              Budget <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>(optional)</span>
            </label>
            <input id="rq-budget" type="text" inputMode="numeric" placeholder="e.g. ₱2M – ₱6M" />
          </div>
          <div className="field">
            <label htmlFor="rq-notes">
              Details <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>(optional)</span>
            </label>
            <textarea id="rq-notes" rows={3} placeholder="Lot size, must-have features, timeline…" />
          </div>
          <div className="field">
            <label htmlFor="rq-email">Your email</label>
            <input id="rq-email" type="email" autoComplete="email" inputMode="email" required />
            <div className="ferr">Enter a valid email so we can notify you.</div>
          </div>
          <button className="mbtn" type="submit">Submit Request</button>
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
