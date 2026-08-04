'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { transitionListing, type ActionResult } from '@/app/admin/actions'
import { LifecyclePanel, type TransitionOption } from '@/components/admin/LifecyclePanel'

/**
 * The sticky bar at the top of a listing: what this listing is, what state it is in, the
 * way back to the list, and the one move that is usually being worked towards.
 *
 * WHY THE PRIMARY MOVE IS PROMOTED HERE. Publish used to sit last, under five stacked
 * panels, while the reasons it was unavailable were computed on the server and rendered in
 * that same last panel. So the answer to "why can't I publish this?" was below the fold of
 * the thing you had scrolled past. The reasons now sit at the top as a checklist and the
 * action sits beside them.
 *
 * The safety properties are the panel's, unchanged, because it is the same server action:
 * `expectedFrom` is the status the page was RENDERED with, so if someone else moved this
 * listing in the meantime the action refuses rather than applying a move to a state the
 * clerk never saw. And the button stays visible while blocked, disabled — a hidden button
 * teaches nobody why publishing is not available.
 *
 * SECONDARY MOVES (listing encoding v2 piece 3). Sell, withdraw, send-back and relist —
 * whatever `primary` didn't already claim — used to sit in `LifecyclePanel` as a fourth
 * section on the encoding page. The brief's "three steps, not four" means the encoding
 * page (details/features/photos) has no status controls on it at all now, so those moves
 * live behind the "Status" trigger here instead. `LifecyclePanel` itself is unchanged
 * beyond the shorter `transitions` list it is given — only where it mounts moved.
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
  secondary,
  publishedAtLabel,
  soldAtLabel,
}: {
  listingId: string
  status: string
  statusLabel: string
  title: string
  meta: string
  backHref: string
  publicHref: string | null
  primary: TransitionOption | null
  secondary: TransitionOption[]
  publishedAtLabel: string | null
  soldAtLabel: string | null
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    transitionListing,
    null
  )
  const [confirming, setConfirming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  /**
   * Closes the confirm prompt after a successful move, the same render-time-adjustment
   * trick `ListingForm` uses for its own settle detection. Without this, `confirming`
   * stays `true` across a `revalidatePath` refresh — no navigation happens, so this
   * component never remounts — and the NEXT primary this listing offers (a different
   * transition entirely) opens already showing "Yes — …" instead of its own button.
   * A failed attempt leaves it open on purpose, so a blocked/denied move can be retried
   * without an extra click.
   */
  const [settled, setSettled] = useState(state)
  if (settled !== state) {
    setSettled(state)
    if (state?.ok) setConfirming(false)
  }

  const blocked = (primary?.blockedBy.length ?? 0) > 0
  const failure = state && !state.ok ? state : null

  return (
    <div className="aabar">
      <div className="aabar-id">
        <h1 className="ttl">{title}</h1>
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

        {/* Three reasons this can be true beyond "there's a secondary move right now":
            a sold listing has zero transitions, so `secondary` alone would hide the
            trigger and lose LifecyclePanel's "Sold is final" explanation with it; and
            `menuOpen` keeps the trigger (and the panel behind it) mounted through the
            moment a secondary move succeeds and drains `secondary` to empty — otherwise
            the panel, and the success message inside it, would vanish the instant the
            action that produced that message finished. */}
        {(secondary.length > 0 || status === 'sold' || menuOpen) && (
          <span className="aabar-status">
            <button
              className="btn btn-ghost abtn-sm"
              type="button"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              Status ▾
            </button>
            {menuOpen && (
              <span className="aabar-menu">
                <LifecyclePanel
                  listingId={listingId}
                  status={status}
                  statusLabel={statusLabel}
                  transitions={secondary}
                  publishedAtLabel={publishedAtLabel}
                  soldAtLabel={soldAtLabel}
                />
              </span>
            )}
          </span>
        )}

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
