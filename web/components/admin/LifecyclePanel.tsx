'use client'

import { useActionState, useState } from 'react'
import { transitionListing, type ActionResult } from '@/app/admin/actions'

export type TransitionOption = {
  to: string
  label: string
  hint: string
  blockedBy: string[]
}

/**
 * The lifecycle controls: submit, kick back, publish, sell, withdraw, relist.
 *
 * Two things here are load-bearing rather than decorative.
 *
 * `expectedFrom` carries the status this page was rendered with. The action compares it
 * against the stored status and refuses if they differ, so two staff working the same
 * listing cannot both believe they published it.
 *
 * The publish button stays visible when it is blocked, disabled, with the missing pieces
 * listed above it by name. A hidden button teaches nobody why publishing is not
 * available; "no ground validation has been recorded" tells someone what to go and do.
 */
export function LifecyclePanel({
  listingId,
  status,
  statusLabel,
  transitions,
  publishedAtLabel,
  soldAtLabel,
}: {
  listingId: string
  status: string
  statusLabel: string
  transitions: TransitionOption[]
  publishedAtLabel: string | null
  soldAtLabel: string | null
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    transitionListing,
    null
  )
  const [confirming, setConfirming] = useState<string | null>(null)

  const failure = state && !state.ok ? state : null

  return (
    <section className="apanel" aria-labelledby="lifecycleH">
      <h2 id="lifecycleH">Status and publishing</h2>
      <p className="sub2">
        Currently <b>{statusLabel}</b>
        {publishedAtLabel ? ` · first published ${publishedAtLabel}` : ''}
        {soldAtLabel ? ` · sold ${soldAtLabel}` : ''}.
      </p>

      {state?.ok && state.message && (
        <div className="fmsg ok" role="status">
          {state.warning ?? state.message}
        </div>
      )}
      {failure && (
        <div className="fmsg err" role="alert">
          {failure.message}
        </div>
      )}

      {transitions.length ? (
        <div className="atrans">
          {transitions.map((option) => {
            const blocked = option.blockedBy.length > 0
            const isConfirming = confirming === option.to

            return (
              <div key={option.to}>
                <div className="t">
                  <b>{option.label}</b>
                  <span className="amuted">{option.hint}</span>
                  {blocked && (
                    <ul className="ablockers">
                      {option.blockedBy.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* The form is always rendered so `expectedFrom` is part of the served
                    HTML — the status this page was built from, not one the browser
                    invented later. Only its contents change when confirming. */}
                <form action={formAction} className="aactions">
                  <input type="hidden" name="listingId" value={listingId} />
                  <input type="hidden" name="to" value={option.to} />
                  <input type="hidden" name="expectedFrom" value={status} />

                  {isConfirming ? (
                    <>
                      <button className="btn btn-gold" type="submit" disabled={pending}>
                        {pending ? 'Working…' : `Yes — ${option.label.toLowerCase()}`}
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={() => setConfirming(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-dark"
                      type="button"
                      disabled={blocked || pending}
                      onClick={() => setConfirming(option.to)}
                    >
                      {option.label}
                    </button>
                  )}
                </form>
              </div>
            )
          })}
        </div>
      ) : status === 'sold' ? (
        <div className="empty">
          <b>This listing is sold</b>
          Sold is final. Reopening a closed sale is a deliberate correction in the database, not a
          button here.
        </div>
      ) : (
        // Reachable since piece 3: `transitions` is now the SECONDARY moves only, and it
        // drains to empty the moment the one it held succeeds — this menu stays open
        // through that (see ListingActionBar) so the message above stays visible, and
        // lands here rather than the sold copy, which would be wrong for every other
        // status.
        <div className="empty">Nothing else to do here right now.</div>
      )}
    </section>
  )
}
