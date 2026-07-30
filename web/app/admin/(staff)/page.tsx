import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ADMIN_PAGE_SIZE,
  ADMIN_SORTS,
  ADMIN_SORT_KEYS,
  STATUS_LABELS,
  STATUS_ORDER,
  getAdminListings,
  type AdminListingRow,
} from '@/lib/admin/queries'

export const metadata: Metadata = { title: 'Listings' }

type Search = Record<string, string | string[] | undefined>

function one(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  const trimmed = first?.trim()
  return trimmed ? trimmed : undefined
}

/** Keeps the current filter, search and sort while changing one of them. */
function withParams(current: Search, changes: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const key of ['status', 'q', 'sort', 'page']) {
    const value = one(current[key])
    if (value) params.set(key, value)
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) params.delete(key)
    else params.set(key, value)
  }
  const query = params.toString()
  return `/admin${query ? `?${query}` : ''}`
}

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

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const params = await searchParams
  const status = one(params.status)
  const q = one(params.q)
  const sort = one(params.sort)
  const page = Math.max(1, Number(one(params.page) ?? '1') || 1)

  const result = await getAdminListings({ status, q, sort, page })

  return (
    <>
      <h1>Listings</h1>
      <p className="lede">
        Every listing in every status — this is the only screen that can see a draft.{' '}
        {result.total} in total{statusLabelOf(status) ? ` · showing ${statusLabelOf(status)}` : ''}.
      </p>

      <div className="tabs" role="navigation" aria-label="Filter by status">
        <Link
          href={withParams(params, { status: undefined, page: undefined })}
          aria-current={status ? undefined : 'true'}
        >
          All
        </Link>
        {STATUS_ORDER.map((value) => (
          <Link
            key={value}
            href={withParams(params, { status: value, page: undefined })}
            aria-current={status === value ? 'true' : undefined}
          >
            {STATUS_LABELS[value]}
          </Link>
        ))}
      </div>

      {/* A plain GET form: the whole screen is server-rendered, so searching is a
          navigation and works with JavaScript switched off. */}
      <form className="afilters" method="get" action="/admin">
        {status && <input type="hidden" name="status" value={status} />}
        <div className="field">
          <label htmlFor="admin-q">Search title, address or area</label>
          <input id="admin-q" name="q" type="search" defaultValue={q ?? ''} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="admin-sort">Order by</label>
          <select id="admin-sort" name="sort" defaultValue={sort ?? 'updated'}>
            {ADMIN_SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {ADMIN_SORTS[key].label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-navy" type="submit">
          Apply
        </button>
        {(q || sort) && (
          <Link className="btn btn-ghost" href={withParams(params, { q: undefined, sort: undefined, page: undefined })}>
            Clear
          </Link>
        )}
      </form>

      {result.rows.length ? (
        <div className="alist">
          {result.rows.map((row) => (
            <div className="arow" key={row.id}>
              <span className={pillClass(row)}>{row.statusLabel}</span>
              <div className="t">
                <b>{row.title}</b>
                <span className="meta">
                  {row.categoryLabel} · {row.location} · {row.priceLabel}
                </span>
                <span className="meta">
                  {row.photoCount} photo{row.photoCount === 1 ? '' : 's'}
                  {row.photoCount > 0 && row.primaryCount !== 1 ? ' · no cover chosen' : ''}
                  {row.updatedAtLabel ? ` · changed ${row.updatedAtLabel}` : ''}
                </span>
              </div>
              <Link className="btn btn-navy abtn-sm" href={`/admin/listings/${row.id}`}>
                Open
              </Link>
              {(row.status === 'live' || row.status === 'sold') && (
                <Link className="btn btn-ghost abtn-sm" href={`/property/${row.slug}`}>
                  View public page
                </Link>
              )}
            </div>
          ))}
        </div>
      ) : result.total > 0 ? (
        <div className="empty">
          <b>That page doesn&rsquo;t exist</b>
          This list has {result.pageCount} page{result.pageCount === 1 ? '' : 's'} of{' '}
          {ADMIN_PAGE_SIZE}. Start again from the first one.
          <div>
            <Link className="btn btn-navy" href={withParams(params, { page: undefined })}>
              Go to page 1
            </Link>
          </div>
        </div>
      ) : (
        <div className="empty">
          <b>No listings match</b>
          {q || status
            ? 'Clear the search or pick a different status.'
            : 'Nothing has been created yet. Start the first one.'}
          <div>
            <Link className="btn btn-gold" href="/admin/listings/new">
              New listing
            </Link>
          </div>
        </div>
      )}

      {result.pageCount > 1 && (
        <nav className="pagination" aria-label="Listing pages">
          {Array.from({ length: result.pageCount }, (_, index) => (
            <Link
              key={index}
              href={withParams(params, { page: String(index + 1) })}
              aria-current={result.page === index + 1 ? 'page' : undefined}
            >
              {index + 1}
            </Link>
          ))}
        </nav>
      )}
    </>
  )
}
