import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminToolbar } from '@/components/admin/AdminToolbar'
import { filterQuery, one, pageWindow, withParams } from '@/lib/admin/navigation'
import {
  ADMIN_PAGE_SIZE,
  ADMIN_SORTS,
  ADMIN_SORT_KEYS,
  STATUS_LABELS,
  STATUS_ORDER,
  getAdminAttention,
  getAdminListings,
  getAdminStatusCounts,
  type AdminListingRow,
} from '@/lib/admin/queries'

export const metadata: Metadata = { title: 'Listings' }

type Search = Record<string, string | string[] | undefined>

/** The label for a `?status=` value, or null when it is not one of the five. */
function statusLabelOf(value: string | undefined): string | null {
  const match = STATUS_ORDER.find((status) => status === value)
  return match ? STATUS_LABELS[match] : null
}

/** Live reads as a good outcome, everything else as work in progress. */
function pillClass(row: AdminListingRow): string {
  if (row.status === 'live') return 'pill ok'
  if (row.status === 'sold') return 'pill'
  return 'pill muted'
}

/**
 * "2 with no cover photo, 1 with no property no."
 *
 * The chip wording is reused rather than re-phrased into "missing a …", which is how the
 * first build produced "20 missing a photos".
 */
function attentionSummary(reasons: { chip: string; count: number }[]): string {
  return reasons
    .map((reason) => `${reason.count} with ${reason.chip.toLowerCase()}`)
    .join(', ')
}

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const params = await searchParams
  const status = one(params.status)
  const q = one(params.q)
  const sort = one(params.sort)
  const attn = one(params.attn) === '1'
  const page = Math.max(1, Number(one(params.page) ?? '1') || 1)

  // The attention set is computed over the whole draft/verifying population, not over the
  // page being rendered, so the count in the strip is the real one and "show only these"
  // can filter across pages.
  const [counts, attention] = await Promise.all([getAdminStatusCounts(), getAdminAttention()])

  const result = await getAdminListings({
    status,
    q,
    sort,
    page,
    ids: attn ? attention.ids : undefined,
  })

  const back = filterQuery(params)
  const openHref = (id: string) => `/admin/listings/${id}${back ? `?back=${encodeURIComponent(back)}` : ''}`
  const filtered = Boolean(q || status || attn)

  return (
    <>
      <h1>Listings</h1>
      <p className="lede">
        Every listing in every status — this is the only screen that can see a draft.{' '}
        {result.total} in total{statusLabelOf(status) ? ` · showing ${statusLabelOf(status)}` : ''}
        {attn ? ' · showing only listings that need attention' : ''}.
      </p>

      {/* One control block. Status, search and order used to be three stacked rows, which
          is what made the screen feel like a form to fill in before it would answer. */}
      <div className="atoolbar">
        <nav className="asegmented" aria-label="Filter by status">
          <Link
            href={withParams(params, { status: undefined, page: undefined, attn: undefined })}
            aria-current={!status && !attn ? 'true' : undefined}
          >
            All <span className="n">{counts.all}</span>
          </Link>
          {STATUS_ORDER.map((value) => (
            <Link
              key={value}
              href={withParams(params, { status: value, page: undefined, attn: undefined })}
              aria-current={status === value ? 'true' : undefined}
            >
              {STATUS_LABELS[value]} <span className="n">{counts[value]}</span>
            </Link>
          ))}
        </nav>

        <AdminToolbar
          status={status}
          attn={attn}
          q={q}
          sort={sort}
          sorts={ADMIN_SORT_KEYS.map((key) => ({ key, label: ADMIN_SORTS[key].label }))}
        />

        {filtered && (
          <Link className="btn btn-ghost abtn-sm" href="/admin">
            Clear
          </Link>
        )}
      </div>

      {/* Publish blockers said once, at the top, where they can be acted on — instead of
          only as grey meta text on whichever rows happen to be on this page. */}
      {attention.ids.length > 0 && !attn && (
        <div className="aattention">
          <span>
            <b>
              {attention.ids.length} listing{attention.ids.length === 1 ? '' : 's'} need
              {attention.ids.length === 1 ? 's' : ''} attention
            </b>{' '}
            before going live: {attentionSummary(attention.reasons)}.
          </span>
          <Link href={withParams(params, { attn: '1', status: undefined, page: undefined })}>
            Show only these
          </Link>
        </div>
      )}

      {result.rows.length ? (
        <div className="atable">
          <div className="atablehead" aria-hidden="true">
            <span>Property no.</span>
            <span>Status</span>
            <span>Listing</span>
            <span>Price</span>
            <span>Changed</span>
            <span />
          </div>

          {result.rows.map((row) => (
            <div className="arow" key={row.id}>
              {/* The office's own reference gets a column of its own: it is what gets
                  quoted on the phone, and a column can be scanned where a meta line
                  has to be re-read. */}
              <span className={row.propertyNo ? 'ref' : 'ref unset'}>
                {row.propertyNo ?? 'not set'}
              </span>

              <span>
                <span className={pillClass(row)}>{row.statusLabel}</span>
              </span>

              <span className="t">
                <b>{row.title}</b>
                <span className="meta">
                  {row.categoryLabel} · {row.location} · {row.photoCount} photo
                  {row.photoCount === 1 ? '' : 's'}
                </span>
                {row.needsAttention &&
                  row.blockers.map((blocker) => (
                    <span className="achip" key={blocker}>
                      {blocker}
                    </span>
                  ))}
              </span>

              <span className="amt">{row.priceLabel}</span>
              <span className="when">{row.updatedAtLabel ?? '—'}</span>

              <span className="acts">
                <Link className="btn btn-dark abtn-sm" href={openHref(row.id)}>
                  Open
                </Link>
                {(row.status === 'live' || row.status === 'sold') && (
                  <Link className="btn btn-ghost abtn-sm" href={`/property/${row.slug}`}>
                    View public
                  </Link>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : result.total > 0 ? (
        <div className="empty">
          <b>That page doesn&rsquo;t exist</b>
          This list has {result.pageCount} page{result.pageCount === 1 ? '' : 's'} of{' '}
          {ADMIN_PAGE_SIZE}. Start again from the first one.
          <div>
            <Link className="btn btn-dark" href={withParams(params, { page: undefined })}>
              Go to page 1
            </Link>
          </div>
        </div>
      ) : (
        <div className="empty">
          <b>No listings match</b>
          {filtered
            ? 'Clear the search or pick a different status.'
            : 'Nothing has been created yet. Start the first one.'}
          <div>
            {filtered ? (
              <Link className="btn btn-dark" href="/admin">
                Clear the filters
              </Link>
            ) : (
              <Link className="btn btn-gold" href="/admin/listings/new">
                New listing
              </Link>
            )}
          </div>
        </div>
      )}

      {result.pageCount > 1 && (
        <nav className="apager" aria-label="Listing pages">
          {result.page > 1 && (
            <Link href={withParams(params, { page: String(result.page - 1) })} rel="prev">
              <span aria-hidden="true">‹</span>
              <span className="sr-only">Previous page</span>
            </Link>
          )}

          {pageWindow(result.page, result.pageCount).map((entry, index) =>
            entry === 'gap' ? (
              <span className="gap" key={`gap-${index}`} aria-hidden="true">
                …
              </span>
            ) : (
              <Link
                key={entry}
                href={withParams(params, { page: String(entry) })}
                aria-current={result.page === entry ? 'page' : undefined}
                aria-label={`Page ${entry}`}
              >
                {entry}
              </Link>
            )
          )}

          {result.page < result.pageCount && (
            <Link href={withParams(params, { page: String(result.page + 1) })} rel="next">
              <span aria-hidden="true">›</span>
              <span className="sr-only">Next page</span>
            </Link>
          )}

          <span className="count">
            {result.total} listing{result.total === 1 ? '' : 's'}
          </span>
        </nav>
      )}
    </>
  )
}
