'use client'

import { useActionState } from 'react'
import { recordVerificationEvent, type ActionResult } from '@/app/admin/actions'

export type VerificationEventView = {
  id: string
  kind: string
  kindLabel: string
  notes: string | null
  occurredAtLabel: string | null
  actorName: string
}

/**
 * The verification record — the part of this product the brand actually rests on.
 *
 * It is append-only, here and in the database. There is no edit control and no delete
 * control, and the row-level policies grant neither, so a mistake is corrected by
 * recording a further event rather than by rewriting history.
 *
 * Nothing on this panel lets the browser say *who* performed a check or *when*: the
 * actor comes from the session and the timestamp from the database clock. All the form
 * carries is which check was done and what was found.
 */
export function VerificationPanel({
  listingId,
  events,
}: {
  listingId: string
  events: VerificationEventView[]
}) {
  return (
    <section className="apanel" aria-labelledby="verifyH">
      <h2 id="verifyH">Verification record</h2>
      <p className="sub2">
        Both a title check and a ground validation have to be recorded before a listing can go
        live. Entries cannot be edited or deleted afterwards — record a further entry to correct
        one.
      </p>

      <RecordForm
        listingId={listingId}
        kind="title_check"
        title="Record a title check"
        hint="What the Registry of Deeds showed. Notes are optional but worth having."
        notesRequired={false}
        submitLabel="Record title check"
      />

      <RecordForm
        listingId={listingId}
        kind="ground_validation"
        title="Record a ground validation"
        hint="Who walked the boundary and what they found. At least 10 characters."
        notesRequired
        submitLabel="Record ground validation"
      />

      <h2 style={{ fontSize: 16, marginTop: 22, marginBottom: 10 }}>
        Recorded so far {events.length > 0 && <span className="amuted">({events.length})</span>}
      </h2>

      {events.length ? (
        <div className="alist">
          {events.map((event) => (
            <div className="arow" key={event.id}>
              <span className={event.kind === 'published' ? 'pill ok' : 'pill'}>
                {event.kindLabel}
              </span>
              <div className="t">
                <b>{event.actorName}</b>
                <span className="meta">{event.occurredAtLabel ?? 'Time not recorded'}</span>
                {event.notes && <span className="meta">{event.notes}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <b>Nothing recorded yet</b>
          Record the title check and the ground validation here as they happen. Publishing is
          blocked until both exist.
        </div>
      )}
    </section>
  )
}

function RecordForm({
  listingId,
  kind,
  title,
  hint,
  notesRequired,
  submitLabel,
}: {
  listingId: string
  kind: 'title_check' | 'ground_validation'
  title: string
  hint: string
  notesRequired: boolean
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    recordVerificationEvent,
    null
  )

  const failure = state && !state.ok ? state : null
  const notesError = failure?.fieldErrors?.notes

  return (
    <form action={formAction} style={{ marginBottom: 18 }}>
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="kind" value={kind} />

      {state?.ok && state.message && (
        <div className="fmsg ok" role="status">
          {state.message}
        </div>
      )}
      {failure && !notesError && (
        <div className="fmsg err" role="alert">
          {failure.message}
        </div>
      )}

      <div className={`field${notesError ? ' invalid' : ''}`}>
        <label htmlFor={`notes-${kind}`}>
          {title} {!notesRequired && <span className="amuted">(notes optional)</span>}
        </label>
        <textarea
          id={`notes-${kind}`}
          name="notes"
          rows={2}
          maxLength={2000}
          required={notesRequired}
          minLength={notesRequired ? 10 : undefined}
          placeholder={hint}
        />
        <div className="hint">{hint}</div>
        <div className="ferr">{notesError ?? 'Add a little more detail.'}</div>
      </div>

      <button className="btn btn-navy" type="submit" disabled={pending}>
        {pending ? 'Recording…' : submitLabel}
      </button>
    </form>
  )
}
