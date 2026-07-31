'use client'

import { useActionState } from 'react'
import { toggleRequestHandled, type ActionResult } from '@/app/admin/actions'

/**
 * The one control on a request row: handled / not handled.
 *
 * `handled` is the value being MOVED TO, put in the served HTML rather than worked out
 * in the browser, so the button says what it will do and posts exactly that. The list is
 * revalidated server-side after the write, so the row redraws with the stored value and
 * not with anything guessed here.
 *
 * Ticking a request also takes it out of the alert candidate set — that is the same
 * column the unsubscribe link sets — so the hint says so on the button's own row.
 */
export function RequestHandledToggle({
  requestId,
  isHandled,
}: {
  requestId: string
  isHandled: boolean
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    toggleRequestHandled,
    null
  )

  const failure = state && !state.ok ? state : null

  return (
    <form action={formAction} className="aactions">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="handled" value={isHandled ? 'false' : 'true'} />
      <button
        className={isHandled ? 'btn btn-ghost abtn-sm' : 'btn btn-navy abtn-sm'}
        type="submit"
        disabled={pending}
      >
        {pending ? 'Saving…' : isHandled ? 'Reopen' : 'Mark handled'}
      </button>
      {failure && (
        <span className="fmsg err" role="alert">
          {failure.message}
        </span>
      )}
    </form>
  )
}
