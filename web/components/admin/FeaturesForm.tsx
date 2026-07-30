'use client'

import { useActionState } from 'react'
import { saveListingFeatures, type ActionResult } from '@/app/admin/actions'

/**
 * The feature chips a listing carries.
 *
 * Submitting with nothing ticked means "no features", and the action clears them all.
 * That has to be the behaviour: a form that treated an empty submission as "no change"
 * would make removing the last feature impossible from the UI.
 */
export function FeaturesForm({
  listingId,
  features,
  selectedIds,
}: {
  listingId: string
  features: { id: string; name: string }[]
  selectedIds: string[]
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    saveListingFeatures,
    null
  )

  const selected = new Set(selectedIds)
  const failure = state && !state.ok ? state : null

  return (
    <form action={formAction} className="apanel">
      <h2>Features</h2>
      <p className="sub2">
        What the buyer gets. Tick everything that applies; the public page shows them as chips,
        with &ldquo;Titled&rdquo; first.
      </p>

      {state?.ok && state.message && (
        <div className="fmsg ok" role="status">
          {state.message}
        </div>
      )}
      {failure && (
        <div className="fmsg err" role="alert">
          {failure.message}
        </div>
      )}

      <input type="hidden" name="listingId" value={listingId} />

      {features.length ? (
        <div className="achecks">
          {features.map((feature) => (
            <label key={feature.id} htmlFor={`feat-${feature.id}`}>
              <input
                id={`feat-${feature.id}`}
                type="checkbox"
                name="featureIds"
                value={feature.id}
                defaultChecked={selected.has(feature.id)}
              />
              {feature.name}
            </label>
          ))}
        </div>
      ) : (
        <div className="empty">
          <b>No features are set up yet</b>
          The feature list is shared across all listings and is managed in the database.
        </div>
      )}

      <div className="aactions">
        <button className="btn btn-navy" type="submit" disabled={pending || !features.length}>
          {pending ? 'Saving…' : 'Save features'}
        </button>
        <span className="amuted">
          {selectedIds.length} saved right now. Unticking one removes it when you save.
        </span>
      </div>
    </form>
  )
}
