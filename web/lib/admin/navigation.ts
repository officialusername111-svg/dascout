/**
 * URL shaping for the admin listings screens — kept out of the page components so the two
 * pieces of logic that are easy to get quietly wrong can be tested directly.
 */

type Search = Record<string, string | string[] | undefined>

/**
 * The only query keys the listings index owns. Everything here is an allowlist rather than
 * a denylist, which is what makes `backHrefFrom` safe by construction.
 */
export const FILTER_KEYS = ['status', 'q', 'sort', 'page', 'attn'] as const

export function one(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  const trimmed = first?.trim()
  return trimmed ? trimmed : undefined
}

/** The current filter state as a query string — what "Back to listings" has to restore. */
export function filterQuery(current: Search): string {
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const value = one(current[key])
    if (value) params.set(key, value)
  }
  return params.toString()
}

/** Keeps the current filter, search and sort while changing one of them. */
export function withParams(current: Search, changes: Record<string, string | undefined>): string {
  const params = new URLSearchParams(filterQuery(current))
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) params.delete(key)
    else params.set(key, value)
  }
  const query = params.toString()
  return `/admin${query ? `?${query}` : ''}`
}

/**
 * Rebuilds the listings URL a visitor came from, for the "Back to listings" link.
 *
 * THE BUG THIS FIXES: the link used to be a bare `/admin`, so opening a listing from
 * "Draft, sorted by title, page 3" and coming back landed on an unfiltered page 1. Every
 * edit cost the clerk their place in the list.
 *
 * IT NEVER TRUSTS THE PARAMETER. `back` arrives in a URL, so it is attacker-controlled in
 * exactly the way an open redirect is: `?back=//evil.example.com` would otherwise put a
 * link to somebody else's site inside the admin panel wearing our own "Back to listings"
 * label. This does not VALIDATE the string, it REBUILDS it — the value is parsed as a
 * query string and only the five allowlisted keys are copied out, so the result is always
 * a path under `/admin` whatever arrives. Anything else degrades to plain `/admin`.
 */
export function backHrefFrom(raw: string | undefined): string {
  if (!raw) return '/admin'

  const incoming = new URLSearchParams(raw)
  const safe = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const value = incoming.get(key)?.trim()
    if (value) safe.set(key, value)
  }

  const query = safe.toString()
  return `/admin${query ? `?${query}` : ''}`
}

/**
 * First page, last page, and the current page with a neighbour either side — everything
 * between becomes a gap.
 *
 * The old pager rendered one link per page, so a table with 40 pages produced 40 buttons
 * and the row of numbers became the widest thing on the screen.
 */
export function pageWindow(current: number, count: number): (number | 'gap')[] {
  const wanted = [1, count, current - 1, current, current + 1]
  const pages = [...new Set(wanted)]
    .filter((page) => page >= 1 && page <= count)
    .sort((a, b) => a - b)

  const out: (number | 'gap')[] = []
  let previous = 0
  for (const page of pages) {
    if (previous && page - previous > 1) out.push('gap')
    out.push(page)
    previous = page
  }
  return out
}
