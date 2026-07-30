'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { clearAccountHistory } from '@/app/account/actions'
import { clearLocalHistory, useUI } from '@/components/ui-state'
import { timeAgo } from '@/lib/format'
import type { HistoryEntryView } from '@/lib/account/queries'

/**
 * Browsing history, from both places it is kept.
 *
 * The account holds what was viewed while signed in; this browser holds what it has seen
 * whether signed in or not. Showing only one of them would be wrong in both directions —
 * the account's list is missing everything viewed before signing in, and the browser's is
 * missing everything viewed on a phone. So they are unioned by listing, later timestamp
 * winning, and each row says which side it came from.
 *
 * Account rows carry a label formatted on the server in Asia/Manila. Device rows are
 * formatted here with `timeAgo`, which is safe only because the local list is empty on
 * the server render and arrives after hydration — the same arrangement the home page's
 * "Continue browsing" already uses.
 */
export function HistoryList({
  accountEntries,
  titles,
}: {
  accountEntries: HistoryEntryView[]
  titles: Record<string, string>
}) {
  const { history: localHistory, toast } = useUI()
  const [pending, startTransition] = useTransition()
  const [cleared, setCleared] = useState(false)

  const rows = useMemo(() => {
    if (cleared) return []

    const merged = new Map<string, HistoryEntryView>()
    for (const entry of accountEntries) merged.set(entry.slug, entry)

    for (const entry of localHistory) {
      const existing = merged.get(entry.slug)

      // Already on the account. It stays an account row — that is where it is stored and
      // that is what the disclosure above is about — but if this device saw it more
      // recently, the more recent time is the true one. A label formatted on the server
      // no longer describes that time, so the row falls back to the local wording.
      if (existing) {
        if (entry.at > existing.at) {
          merged.set(entry.slug, { ...existing, at: entry.at, label: null })
        }
        continue
      }

      merged.set(entry.slug, {
        slug: entry.slug,
        title: titles[entry.slug] ?? deslugify(entry.slug),
        status: titles[entry.slug] ? 'live' : 'unknown',
        at: entry.at,
        label: null,
        source: 'device',
      })
    }

    return [...merged.values()].sort((a, b) => b.at - a.at).slice(0, 50)
  }, [accountEntries, localHistory, titles, cleared])

  /**
   * Server first, then this browser. The other order would clear the local list and then
   * fail on the server, leaving the account still holding the history while the person
   * has been told it is gone.
   */
  const clear = () => {
    startTransition(async () => {
      const result = await clearAccountHistory()
      if (!result.ok) {
        toast('Could not clear the history on your account. Try again.')
        return
      }
      clearLocalHistory()
      setCleared(true)
      toast('Browsing history cleared')
    })
  }

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 19 }}>Recently viewed</h2>
          <p className="amuted">
            Views made while you are signed in are saved to your account and visible to DaScout
            staff. Clearing removes your name from them — the property&rsquo;s view count is not
            changed.
          </p>
        </div>
        {rows.length > 0 && (
          <button className="btn btn-ghost abtn-sm" type="button" onClick={clear} disabled={pending}>
            {pending ? 'Clearing…' : 'Clear browsing history'}
          </button>
        )}
      </div>

      {rows.length ? (
        <div className="alist">
          {rows.map((row) => (
            <div className="arow" key={row.slug}>
              <span className={row.status === 'live' ? 'pill ok' : 'pill muted'}>
                {row.status === 'live' ? 'Listed' : row.status === 'sold' ? 'Sold' : 'Not listed'}
              </span>
              <div className="t">
                <b>{row.title}</b>
                <span className="meta">
                  {row.label ?? `Viewed ${timeAgo(row.at)}`} ·{' '}
                  {row.source === 'account' ? 'on your account' : 'on this device'}
                </span>
              </div>
              {row.status === 'live' && (
                <Link className="btn btn-ghost abtn-sm" href={`/property/${row.slug}`}>
                  Open
                </Link>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <b>Nothing viewed yet</b>
          Properties you open will appear here so you can pick up where you left off.
          <div>
            <Link className="btn btn-navy" href="/#listings">
              Browse all listings
            </Link>
          </div>
        </div>
      )}
    </>
  )
}

/** Last resort for a device-only row whose listing is no longer public: "tupi-farm-lot". */
function deslugify(slug: string): string {
  return slug
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}
