'use client'

import { useRef } from 'react'

/**
 * The search + sort half of the listings toolbar.
 *
 * WHY THIS IS A CLIENT COMPONENT AT ALL. The old screen put search and sort behind an
 * "Apply" button, so finding a listing cost a click that carried no information — the
 * clerk had already said what they wanted by typing it. Here the sort applies the moment
 * it changes and the search applies on Enter, which is what a search box already promises.
 *
 * WHY IT IS STILL A PLAIN GET FORM UNDERNEATH. Everything above is an enhancement over a
 * form that submits by itself. With JavaScript off, the `<noscript>` button appears and
 * the screen behaves exactly as it used to. Nothing about finding a listing depends on the
 * script arriving — the same rule the rest of this admin follows.
 *
 * The status filter is NOT in here. It is a set of real links rendered on the server, so
 * each status tab is a URL that can be bookmarked, opened in a new tab and crawled by the
 * back button. It only *looks* like part of this control.
 */
export function AdminToolbar({
  status,
  attn,
  q,
  sort,
  sorts,
}: {
  status?: string
  attn?: boolean
  q?: string
  sort?: string
  sorts: { key: string; label: string }[]
}) {
  const form = useRef<HTMLFormElement>(null)

  /**
   * `requestSubmit` rather than `submit`: it runs validation and fires the submit event,
   * which is what a user pressing Enter would have done. `form.submit()` skips both.
   */
  const apply = () => form.current?.requestSubmit()

  return (
    <form className="atoolbar-form" method="get" action="/admin" ref={form} role="search">
      {/* Carried so that searching inside a status tab, or inside the attention filter,
          stays inside it instead of silently throwing the filter away. */}
      {status && <input type="hidden" name="status" value={status} />}
      {attn && <input type="hidden" name="attn" value="1" />}

      <div className="asearch">
        <label className="sr-only" htmlFor="admin-q">
          Search property number, title, address or area
        </label>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          id="admin-q"
          name="q"
          type="search"
          defaultValue={q ?? ''}
          autoComplete="off"
          placeholder="Search property no., title, address or area"
          // Enter submits by itself — this is only for EMPTYING the box, whether by the
          // browser's own ✕ or by deleting the last character, so clearing a search
          // restores the full list without needing a second action. Deliberately not a
          // search-as-you-type: this is a server round trip, and firing one per keystroke
          // would put the database behind every letter.
          onInput={(event) => {
            if (event.currentTarget.value === '') apply()
          }}
        />
      </div>

      <label className="sr-only" htmlFor="admin-sort">
        Order by
      </label>
      <select id="admin-sort" name="sort" defaultValue={sort ?? 'updated'} onChange={apply}>
        {sorts.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>

      <noscript>
        <button className="btn btn-dark abtn-sm" type="submit">
          Apply
        </button>
      </noscript>
    </form>
  )
}
