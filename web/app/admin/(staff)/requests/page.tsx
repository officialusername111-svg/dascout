import type { Metadata } from 'next'
import { getPropertyRequests } from '@/lib/admin/queries'
import { RequestHandledToggle } from '@/components/admin/RequestHandledToggle'

export const metadata: Metadata = { title: 'Requests' }

/**
 * What people have asked us to find for them.
 *
 * Open requests sit at the top because they are the work; handled ones stay visible
 * underneath because "we already dealt with that one" is the answer to half the
 * questions this screen gets asked.
 *
 * Every field on a row is somebody else's typing — the location, the notes, the email
 * address — and every one of them is rendered as a plain React text node. No
 * `dangerouslySetInnerHTML`, no linkification, no markdown. That is not caution for its
 * own sake: this is the only screen in the admin that displays text written by people
 * who are not staff.
 */
export default async function AdminRequestsPage() {
  const rows = await getPropertyRequests()
  const open = rows.filter((row) => !row.isHandled).length

  return (
    <>
      <h1>Requests</h1>
      <p className="lede">
        Saved property requests from the public site. {open} open · {rows.length} in total. Marking
        one handled also stops its match alerts.
      </p>

      {rows.length ? (
        <div className="alist">
          {rows.map((row) => (
            <div className="arow" key={row.id}>
              <span className={row.isHandled ? 'pill muted' : 'pill ok'}>
                {row.isHandled ? 'Handled' : 'Open'}
              </span>
              <div className="t">
                <b>
                  {row.categoryLabel} · {row.preferredTown}
                </b>
                <span className="meta">
                  {row.budgetLabel} · {row.email}
                </span>
                <span className="meta">
                  {row.createdAtLabel ?? 'date unknown'} · {row.alertsSent} alert
                  {row.alertsSent === 1 ? '' : 's'} sent
                </span>
                {row.notes && <span className="meta">{row.notes}</span>}
              </div>
              <RequestHandledToggle requestId={row.id} isHandled={row.isHandled} />
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <b>No requests yet</b>
          When somebody uses &ldquo;Can&rsquo;t find it? Request it.&rdquo; on the public site, it
          lands here.
        </div>
      )}
    </>
  )
}
