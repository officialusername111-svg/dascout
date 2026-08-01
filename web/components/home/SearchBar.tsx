'use client'

import { useRouter } from 'next/navigation'
import { Icon } from '@/components/Icon'
import { CATEGORIES, CATEGORY_KEYS } from '@/lib/categories'
import { SIZE_BANDS } from '@/lib/search-bands'

/* No price filter here: amounts are an admin-only surface on this site. */
export type SearchDefaults = {
  loc?: string
  cat?: string
  size?: string
}

/**
 * The v6 search card: white glass, sitting inside the hero on the right, with all three
 * fields on one line. Location is a `<select>` of the towns we actually have listings in
 * rather than free text, so a search can no longer miss on a typo.
 *
 * Filtering happens in Postgres, so the form just writes the URL and the server
 * re-renders the grid. Without JavaScript the same form submits as a plain GET.
 */
export function SearchBar({
  defaults,
  towns,
}: {
  defaults: SearchDefaults
  towns: { name: string; province: string }[]
}) {
  const router = useRouter()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const params = new URLSearchParams()
    for (const key of ['loc', 'cat', 'size']) {
      const value = String(data.get(key) ?? '').trim()
      if (value) params.set(key, value)
    }
    const query = params.toString()
    router.push(`/${query ? `?${query}` : ''}#listings`)
  }

  return (
    <div className="searchcard">
      <form method="get" action="/" onSubmit={submit}>
        <h2>Find Your Best Property</h2>
        <div className="sfrow">
          <div className="sf">
            <label htmlFor="q-loc">Location</label>
            <select id="q-loc" name="loc" defaultValue={defaults.loc ?? ''}>
              <option value="">All locations</option>
              {towns.map((town) => (
                <option key={town.name} value={town.name}>
                  {town.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sf">
            <label htmlFor="q-cat">Property type</label>
            <select id="q-cat" name="cat" defaultValue={defaults.cat ?? ''}>
              <option value="">Any type</option>
              {CATEGORY_KEYS.map((key) => (
                <option key={key} value={key}>
                  {CATEGORIES[key].label}
                </option>
              ))}
            </select>
          </div>
          <div className="sf">
            <label htmlFor="q-size">Lot / floor area</label>
            <select id="q-size" name="size" defaultValue={defaults.size ?? ''}>
              <option value="">Any size</option>
              {SIZE_BANDS.map((band) => (
                <option key={band.value} value={band.value}>
                  {band.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button className="go" type="submit">
          Search Property
          <span className="circ" aria-hidden="true">
            <Icon name="arrow" />
          </span>
        </button>
      </form>
    </div>
  )
}
