'use client'

import { useActionState, useState } from 'react'
import { updatePhotoMeta, type ActionResult } from '@/app/admin/actions'
import { Icon } from '@/components/Icon'

export type PhotoCardPhoto = {
  id: string
  storagePath: string
  altText: string | null
  sortOrder: number
  isPrimary: boolean
  url: string | null
}

/**
 * One photo: its preview, its alt text, and the four things staff do to it.
 *
 * Reordering and cover changes are handed upwards rather than fired from here, because
 * both are statements about the whole set — the action that persists them takes the
 * complete order, so only the component holding the whole list can build the call.
 *
 * A missing preview is drawn as a labelled placeholder rather than a broken image. The
 * row still exists and still has to be deletable; hiding it would leave a photo nobody
 * can see and nobody can remove.
 */
export function PhotoCard({
  listingId,
  photo,
  index,
  total,
  busy,
  onMove,
  onMakeCover,
  onDelete,
}: {
  listingId: string
  photo: PhotoCardPhoto
  index: number
  total: number
  busy: boolean
  onMove: (index: number, direction: -1 | 1) => void
  onMakeCover: (photoId: string) => void
  onDelete: (photoId: string) => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    updatePhotoMeta,
    null
  )
  const [confirming, setConfirming] = useState(false)

  const failure = state && !state.ok ? state : null
  const altError = failure?.fieldErrors?.altText

  return (
    <div className="aphoto">
      <div className="card">
        {photo.url ? (
          <span className="ph">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              loading="lazy"
              decoding="async"
              src={photo.url}
              alt={photo.altText ?? `Photo ${index + 1}`}
            />
          </span>
        ) : (
          <span className="ph-missing">
            No preview — the file is missing from both photo buckets. Delete this entry and upload
            the photo again.
          </span>
        )}
        {photo.isPrimary && (
          <span className="pill">
            <Icon name="star" />
            <span className="sr-only">Cover photo</span>
          </span>
        )}
      </div>

      <form action={formAction}>
        <input type="hidden" name="listingId" value={listingId} />
        <input type="hidden" name="photoId" value={photo.id} />
        <div className={`field${altError ? ' invalid' : ''}`}>
          <label htmlFor={`alt-${photo.id}`}>
            Description for screen readers <span className="amuted">(optional)</span>
          </label>
          <input
            id={`alt-${photo.id}`}
            name="altText"
            type="text"
            maxLength={200}
            defaultValue={photo.altText ?? ''}
            placeholder="e.g. Frontage seen from the barangay road"
          />
          <div className="ferr">{altError ?? 'Keep this under 200 characters.'}</div>
        </div>
        <div className="aactions">
          <button className="btn btn-ghost" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save text'}
          </button>
          {state?.ok && <span className="amuted">Saved</span>}
          {failure && !altError && <span className="amuted">{failure.message}</span>}
        </div>
      </form>

      {/* One row, icons doing the work three rows of button text used to: reorder is the
          most-repeated and most self-explanatory action here, so it drops its label first
          (direction + the disabled state at either end of the set already say what it
          does). Make cover and delete keep theirs — one is a state change worth naming,
          the other is destructive and must never be a guess from an icon alone. */}
      <div className="aactions">
        <button
          className="btn btn-ghost icon-only"
          type="button"
          disabled={busy || index === 0}
          onClick={() => onMove(index, -1)}
          aria-label={`Move photo ${index + 1} earlier`}
        >
          <Icon name="chev" className="icon flip" />
        </button>
        <button
          className="btn btn-ghost icon-only"
          type="button"
          disabled={busy || index === total - 1}
          onClick={() => onMove(index, 1)}
          aria-label={`Move photo ${index + 1} later`}
        >
          <Icon name="chev" />
        </button>
        {!photo.isPrimary && (
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy}
            onClick={() => onMakeCover(photo.id)}
          >
            <Icon name="star" /> Make cover
          </button>
        )}

        {/* Two clicks to delete. A photo is the only thing on this screen whose removal
            also removes a file, so the second click is the confirmation. */}
        {confirming ? (
          <>
            <button
              className="btn btn-dark"
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                onDelete(photo.id)
              }}
            >
              Yes, delete it
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button
            className="btn btn-ghost danger icon-only"
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            aria-label="Delete photo"
          >
            <Icon name="trash" />
          </button>
        )}
      </div>
    </div>
  )
}
