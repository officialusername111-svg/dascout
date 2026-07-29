'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Icon } from '@/components/Icon'
import { CATEGORIES, CATEGORY_KEYS } from '@/lib/categories'
import { PRICE_BANDS, SIZE_BANDS } from '@/lib/search-bands'

export type SearchDefaults = {
  loc?: string
  cat?: string
  price?: string
  size?: string
}

/**
 * Filtering happens in Postgres, so the form just writes the URL and the server
 * re-renders the grid. Without JavaScript the same form submits as a plain GET.
 */
export function SearchBar({
  defaults,
  towns,
  status,
}: {
  defaults: SearchDefaults
  towns: { name: string; province: string }[]
  status: React.ReactNode
}) {
  const router = useRouter()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const params = new URLSearchParams()
    for (const key of ['loc', 'cat', 'price', 'size']) {
      const value = String(data.get(key) ?? '').trim()
      if (value) params.set(key, value)
    }
    const query = params.toString()
    router.push(`/${query ? `?${query}` : ''}#listings`)
  }

  return (
    <>
      <div className="searchbar">
        <form method="get" action="/" onSubmit={submit}>
          <div className="sf">
            <label htmlFor="q-loc">Location</label>
            <input
              id="q-loc"
              name="loc"
              type="text"
              placeholder="City or town in Mindanao"
              list="townList"
              autoComplete="off"
              defaultValue={defaults.loc ?? ''}
            />
            <datalist id="townList">
              {towns.map((town) => (
                <option key={town.name} value={town.name}>
                  {town.name}, {town.province}
                </option>
              ))}
            </datalist>
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
            <label htmlFor="q-price">Price range</label>
            <select id="q-price" name="price" defaultValue={defaults.price ?? ''}>
              <option value="">Any price</option>
              {PRICE_BANDS.map((band) => (
                <option key={band.value} value={band.value}>
                  {band.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sf" style={{ borderRight: 'none' }}>
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
          <div className="go">
            <button className="btn btn-gold" type="submit">
              Search <Icon name="search" />
            </button>
          </div>
        </form>
        <div className="search-status" role="status" aria-live="polite">
          {status}
        </div>
      </div>

      <div className="trust">
        <span>
          <Icon name="check" /> Title-verified listings
        </span>
        <span>
          <Icon name="users" /> Trusted by thousands
        </span>
        <span>
          <Icon name="award" /> Licensed brokers
        </span>
        <span>
          <Icon name="shield" /> Secure transactions
        </span>
      </div>
    </>
  )
}

export function ClearFiltersLink() {
  return <Link href="/#listings">Clear filters</Link>
}
