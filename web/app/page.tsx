import Link from 'next/link'
import { Header, Sidebar, Footer } from '@/components/Chrome'
import { AuthDialog } from '@/components/Dialogs'
import { ListingCardTile } from '@/components/ListingCard'
import { SearchBar } from '@/components/home/SearchBar'
import { SIZE_BANDS } from '@/lib/search-bands'
import {
  ContinueBrowsing,
  FavoritesGrid,
  FavoritesStatus,
  TopProperties,
} from '@/components/home/Panels'
import { AboutRows, VerifiedBand } from '@/components/home/Sections'
import { describeCategory } from '@/lib/categories'
import {
  PAGE_SIZE,
  getAllCards,
  getListings,
  getPopularFeatures,
  getSpotlightListings,
  getTopListings,
  getTowns,
  type ListingFilters,
} from '@/lib/queries'
import { HeroSpotlight } from '@/components/home/HeroSpotlight'

type Search = Record<string, string | string[] | undefined>

function one(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  const trimmed = first?.trim()
  return trimmed ? trimmed : undefined
}

/** The filters as a query string, so tab and page links keep the rest of the search. */
function withParams(filters: Search, changes: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const key of ['cat', 'loc', 'size', 'feat', 'tab', 'page']) {
    const value = one(filters[key])
    if (value) params.set(key, value)
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) params.delete(key)
    else params.set(key, value)
  }
  const query = params.toString()
  return `/${query ? `?${query}` : ''}#listings`
}

/** "12 properties · Residential Lot · in "Tupi"" — what the search actually did. */
function describeFilters(filters: ListingFilters, total: number, labels: { size?: string }) {
  const bits: string[] = []
  if (filters.cat) {
    const label = describeCategory(filters.cat)
    if (label) bits.push(label)
  }
  if (filters.loc) bits.push(`in "${filters.loc}"`)
  if (filters.feat) bits.push(filters.feat.toLowerCase())
  if (labels.size) bits.push(labels.size)
  if (!bits.length) return null
  return `${total} propert${total === 1 ? 'y' : 'ies'} · ${bits.join(' · ')}`
}

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams
  const showFavorites = one(params.favs) === '1'
  const tab = one(params.tab) ?? 'all'
  const page = Math.max(1, Number(one(params.page) ?? '1') || 1)

  /* No price filter on the public site — amounts (and the map) are admin-only surfaces. */
  const filters: ListingFilters = {
    cat: one(params.cat),
    loc: one(params.loc),
    size: one(params.size),
    feat: one(params.feat),
    trending: tab === 'trend',
    shuffle: tab === 'rand',
    page,
  }

  const [towns, spotlight, results, day, week, month, allCards, features] = await Promise.all([
    getTowns(),
    getSpotlightListings(3),
    getListings(filters),
    getTopListings('day'),
    getTopListings('week'),
    getTopListings('month'),
    getAllCards(),
    getPopularFeatures(),
  ])

  const listings = results.listings
  const pages = Math.ceil(results.total / PAGE_SIZE)
  const status = describeFilters(filters, results.total, {
    size: SIZE_BANDS.find((band) => band.value === filters.size)?.label,
  })

  return (
    <>
      <Header current="home" />
      <Sidebar features={features} />

      <HeroSpotlight
        listings={spotlight}
        search={
          <SearchBar
            defaults={{ loc: filters.loc, cat: filters.cat, size: filters.size }}
            towns={towns}
          />
        }
      />

      <main id="main" className="wrap">
        <section id="listings" aria-labelledby="listH">
          <div className="sec-head">
            <div>
              <h2 id="listH">{showFavorites ? 'Saved Properties' : 'Featured Listings'}</h2>
              {/* The search strip is gone, so this line carries the filter feedback — and
                  with it the only way back out of a filtered page. */}
              <p role="status" aria-live="polite">
                {showFavorites ? (
                  <FavoritesStatus listings={allCards} />
                ) : status ? (
                  <>
                    <span>{status}</span> <Link href="/#listings">Clear filters</Link>
                  </>
                ) : (
                  'Fresh on the market across Mindanao.'
                )}
              </p>
            </div>
            {!showFavorites && (
              <div className="tabs">
                <Link
                  href={withParams(params, { tab: undefined, page: undefined })}
                  aria-current={tab === 'all' ? 'true' : undefined}
                >
                  All
                </Link>
                <Link
                  href={withParams(params, { tab: 'trend', page: undefined })}
                  aria-current={tab === 'trend' ? 'true' : undefined}
                >
                  Trending
                </Link>
                <Link
                  href={withParams(params, { tab: 'rand', page: undefined })}
                  aria-current={tab === 'rand' ? 'true' : undefined}
                >
                  Random
                </Link>
              </div>
            )}
          </div>

          {showFavorites ? (
            <FavoritesGrid listings={allCards} />
          ) : listings.length ? (
            <div className="grid">
              {listings.map((listing) => (
                <ListingCardTile key={listing.slug} listing={listing} />
              ))}
            </div>
          ) : results.total > 0 ? (
            <div className="empty">
              <b>That page doesn&rsquo;t exist</b>
              This search has {pages} page{pages === 1 ? '' : 's'}. Start again from the first one.
              <div>
                <Link className="btn btn-dark" href={withParams(params, { page: undefined })}>
                  Go to page 1
                </Link>
              </div>
            </div>
          ) : (
            <div className="empty">
              <b>No properties match your search</b>
              Try widening the size band or clearing a filter.
              <div>
                <Link className="btn btn-dark" href="/#listings">
                  Clear all filters
                </Link>
              </div>
            </div>
          )}

          {!showFavorites && pages > 1 && (
            <nav className="pagination" aria-label="Listings pages">
              {Array.from({ length: pages }, (_, i) => (
                <Link
                  key={i}
                  href={withParams(params, { page: String(i + 1) })}
                  aria-current={page === i + 1 ? 'page' : undefined}
                >
                  {i + 1}
                </Link>
              ))}
            </nav>
          )}
        </section>

        <AboutRows />

        <VerifiedBand />

        <TopProperties periods={{ day, week, month }} />

        <ContinueBrowsing listings={allCards} />
      </main>

      <Footer />
      <AuthDialog />
    </>
  )
}
