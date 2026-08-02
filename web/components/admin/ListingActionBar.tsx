'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { transitionListing, type ActionResult } from '@/app/admin/actions'
import type { TransitionOption } from '@/components/admin/LifecyclePanel'

/**
 * The sticky bar at the top of a listing: what this listing is, what state it is in, the
 * way back to the list, and the one move that is usually being worked towards.
 *
 * WHY THE PRIMARY MOVE IS DUPLICATED HERE. Publish used to sit last, under five stacked
 * panels, while the reasons it was unavailable were computed on the server and rendered in
 * that same last panel. So the answer to "why can't I publish this?" was below the fold of
 * the thing you had scrolled past. The reasons now sit at the top as a checklist and the
 * action sits beside them.
 *
 * It is a duplicate of one row of `LifecyclePanel`, NOT a replacement for it. The panel
 * still owns the full set of moves — sell, withdraw, send back — because those are
 * deliberate acts that deserve the space, and a sticky bar with five buttons in it is a
 * toolbar, not a primary action.
 *
 * The safety properties are the panel's, unchanged, because it is the same server action:
 * `expectedFrom` is the status the page was RENDERED with, so if someone else moved this
 * listing in the meantime the action refuses rather than applying a move to a state the
 * clerk never saw. And the button stays visible while blocked, disabled — a hidden button
 * teaches nobody why publishing is not available.
 */
export function ListingActionBar({
  listingId,
  status,
  statusLabel,
  title,
  meta,
  backHref,
  publicHref,
  primary,
}: {
  listingId: string
  status: string
  statusLabel: string
  title: string
  meta: string
  backHref: string
  publicHref: string | null
  primary: TransitionOption | null
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    transitionListing,
    null
  )
  const [confirming, setConfirming] = useState(false)

  const blocked = (primary?.blockedBy.length ?? 0) > 0
  const failure = state && !state.ok ? state : null

  return (
    <div className="aabar">
      <div className="aabar-id">
        <div className="ttl">{title}</div>
        <div className="meta">{meta}</div>
      </div>

      <span className={status === 'live' ? 'pill ok' : status === 'sold' ? 'pill' : 'pill muted'}>
        {statusLabel}
      </span>

      <div className="aabar-acts">
        {failure && (
          <span className="aabar-err" role="alert">
            {failure.message}
          </span>
        )}

        {publicHref && (
          <Link className="btn btn-ghost abtn-sm" href={publicHref}>
            View public
          </Link>
        )}

        <Link className="btn btn-ghost abtn-sm" href={backHref}>
          Back to listings
        </Link>

        {primary && (
          <form action={formAction}>
            <input type="hidden" name="listingId" value={listingId} />
            <input type="hidden" name="to" value={primary.to} />
            <input type="hidden" name="expectedFrom" value={status} />

            {confirming ? (
              <span className="aabar-confirm">
                <button className="btn btn-gold abtn-sm" type="submit" disabled={pending}>
                  {pending ? 'Working…' : `Yes — ${primary.label.toLowerCase()}`}
                </button>
                <button
                  className="btn btn-ghost abtn-sm"
                  type="button"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                className="btn btn-gold abtn-sm"
                type="button"
                disabled={blocked || pending}
                onClick={() => setConfirming(true)}
                // The checklist above says the same thing at length; this is for anyone
                // who reaches the button first, and for a screen reader announcing why it
                // is disabled.
                title={
                  blocked
                    ? `Not yet: ${primary.blockedBy.join(' ')}`
                    : undefined
                }
              >
                {primary.label}
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
