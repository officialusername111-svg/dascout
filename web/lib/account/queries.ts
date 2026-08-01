import { createClient } from '@/lib/supabase/server'
import { requireAccountUser } from '@/lib/account/auth'
import { CARD_COLUMNS, toCard, type ListingCard, type RawListing } from '@/lib/queries'

/**
 * Everything the account screens read.
 *
 * Every exported function opens with `requireAccountUser()`, exactly as the admin's
 * queries open with `requireStaff()`. That guard is not belt-and-braces over the
 * layout: a query function is the last place before rows leave the database, and it is
 * the only place that still holds when a future route, action or route handler calls it.
 *
 * Row-level security is the real boundary in both cases — `favorites_own` and
 * `listing_views_own_read` both compare `profile_id` to `auth.uid()` — so even a query
 * that forgot its `.eq('profile_id', …)` could not return somebody else's rows. The
 * filters are here anyway, because a query that relies on a policy it does not name is
 * one policy edit away from being wrong.
 */

/** Nobody has a thousand favourites. The cap is here so a runaway read cannot happen. */
const FAVORITES_LIMIT = 1000

/** Read wide, then dedupe by listing: the ledger holds one row per session per day. */
const HISTORY_READ_LIMIT = 200

/**
 * The one clock the whole site uses for stored timestamps. Rows are stored in UTC and
 * read back in the time zone the visitor is actually in, and the label is formatted on
 * the SERVER and passed down as a string — a client that formatted it itself would
 * render a different value than the server did and blow up hydration.
 */
const MANILA_STAMP = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  dateStyle: 'medium',
  timeStyle: 'short',
})

function stampLabel(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : MANILA_STAMP.format(date)
}

/** A favourite card plus the one account-only fact the public card type does not carry. */
export type AccountFavorite = { card: ListingCard; sold: boolean }

/**
 * The favourites saved on the account, newest first, as the same cards the rest of the
 * site renders.
 *
 * `listings!inner` is doing real work: the foreign key cascades, but a listing that has
 * merely been withdrawn still has its favourite row and is invisible to public policy.
 * An outer join would hand the grid a row with no listing attached, which renders as a
 * broken card. Inner means the page shows what it can show, and the count of what it
 * cannot comes from the browser's own mirror instead.
 *
 * `status` rides alongside the card columns because public policy also exposes SOLD
 * rows: without it a sold favourite is indistinguishable from a live one and renders as
 * a normal card whose property link 404s (LH-5). It stays out of `CARD_COLUMNS` itself —
 * the public grids are live-only by query and have no use for it.
 */
export async function getAccountFavorites(): Promise<AccountFavorite[]> {
  const user = await requireAccountUser()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('favorites')
    .select(`created_at, listings!inner ( status, ${CARD_COLUMNS} )`)
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false })
    .limit(FAVORITES_LIMIT)

  if (error) throw error

  return (
    data as unknown as { created_at: string; listings: (RawListing & { status: string }) | null }[]
  )
    .map((row) => row.listings)
    .filter((listing): listing is RawListing & { status: string } => Boolean(listing))
    .map((listing) => ({ card: toCard(listing), sold: listing.status === 'sold' }))
}

export type HistoryEntryView = {
  slug: string
  title: string
  /** Live/sold — a card the visitor can still open, or one that has since gone. */
  status: string
  /** Epoch milliseconds, so the client can merge its own list by recency. */
  at: number
  /** Server-rendered label. The client never reformats this one. */
  label: string | null
  source: 'account' | 'device'
}

/**
 * The browsing history recorded against the account.
 *
 * The select names its columns and never asks for `session_hash`. That column is the
 * hashed view-session id behind the anti-forgery throttle; it is nobody's business on a
 * page, it would sit in the HTML payload, and a `select('*')` here would put it there
 * without anyone deciding to.
 *
 * `listing_views` holds one row per listing per session per day, so the same property
 * viewed across three days is three rows. The page wants a reading list, so rows are
 * deduped by listing keeping the newest.
 */
export async function getAccountHistory(limit = 50): Promise<HistoryEntryView[]> {
  const user = await requireAccountUser()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('listing_views')
    .select('listing_id, viewed_at, listings!inner ( id, slug, title, status )')
    .eq('profile_id', user.id)
    .order('viewed_at', { ascending: false })
    .limit(HISTORY_READ_LIMIT)

  if (error) throw error

  const rows = data as unknown as {
    listing_id: string
    viewed_at: string
    listings: { id: string; slug: string; title: string; status: string } | null
  }[]

  const newestByListing = new Map<string, HistoryEntryView>()
  for (const row of rows) {
    if (!row.listings) continue
    const at = new Date(row.viewed_at).getTime()
    if (Number.isNaN(at)) continue
    const existing = newestByListing.get(row.listing_id)
    if (existing && existing.at >= at) continue
    newestByListing.set(row.listing_id, {
      slug: row.listings.slug,
      title: row.listings.title,
      status: row.listings.status,
      at,
      label: stampLabel(row.viewed_at),
      source: 'account',
    })
  }

  return [...newestByListing.values()].sort((a, b) => b.at - a.at).slice(0, limit)
}

/**
 * Titles for slugs the browser knows about and the account does not.
 *
 * The history page unions the account's rows with the ones this device recorded before
 * (or without) signing in, and a local row is only a slug and a timestamp. Without this
 * the device rows would have to render their slug as a heading, which reads like a bug.
 * It is a two-column read of listings the visitor could already see anyway — public
 * policy limits it to live and sold — so nothing is disclosed that a browse would not.
 */
export async function getPublicListingTitles(): Promise<Record<string, string>> {
  await requireAccountUser()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('listings')
    .select('slug, title')
    .in('status', ['live', 'sold'])
    .limit(500)

  if (error) throw error

  const titles: Record<string, string> = {}
  for (const row of data ?? []) titles[row.slug] = row.title
  return titles
}
