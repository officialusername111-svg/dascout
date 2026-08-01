'use client'

import { useEffect, useRef } from 'react'
import { Icon } from '@/components/Icon'
import { useUI } from '@/components/ui-state'
import { ForgotPanel, RegisterPanel, SignInPanel } from '@/components/account/AuthPanels'

/**
 * The auth dialog: the shell — the dialog element, the tab pair, the close button, the
 * heading — stays here, and each tab's body is a form in
 * `components/account/AuthPanels.tsx` that posts to a server action.
 *
 * The property-request dialog that used to live beside it was removed in the v6 redesign,
 * along with every entry point that opened it. The request DATA layer is untouched —
 * `property_requests`, the match-alert mailer, the admin inbox, and the confirm and
 * unsubscribe routes all still work on the rows that already exist.
 */

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
