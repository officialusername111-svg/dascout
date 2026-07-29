import Link from 'next/link'
import { Header, Sidebar, UtilityBar, Footer } from '@/components/Chrome'
import { AuthDialog, RequestDialog } from '@/components/Dialogs'
import { ListingCardTile } from '@/components/ListingCard'
import { SearchBar } from '@/components/home/SearchBar'
import { PRICE_BANDS, SIZE_BANDS } from '@/lib/search-bands'
import {
  ContinueBrowsing,
  FavoritesGrid,
  FavoritesStatus,
  MarketMovements,
  RequestBand,
  TopProperties,
} from '@/components/home/Panels'
import { AboutRows, LocationsAndFaq, Testimonials, TypeTiles, VerifyBand } from '@/components/home/Sections'
import { describeCategory } from '@/lib/categories'
import {
  PAGE_SIZE,
  getAllCards,
  getCategoryCounts,
  getListings,
  getMarketMovements,
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
  for (const key of ['cat', 'loc', 'price', 'size', 'feat', 'az', 'tab', 'page']) {
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
function describeFilters(filters: ListingFilters, total: number, labels: { price?: string; size?: string }) {
  const bits: string[] = []
  if (filters.cat) {
    const label = describeCategory(filters.cat)
    if (label) bits.push(label)
  }
  if (filters.loc) bits.push(`in "${filters.loc}"`)
  if (filters.az) bits.push(`towns starting with ${filters.az.toUpperCase()}`)
  if (filters.feat) bits.push(filters.feat.toLowerCase())
  if (labels.price) bits.push(labels.price)
  if (labels.size) bits.push(labels.size)
  if (!bits.length) return null
  return `${total} propert${total === 1 ? 'y' : 'ies'} · ${bits.join(' · ')}`
}

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams
  const showFavorites = one(params.favs) === '1'
  const tab = one(params.tab) ?? 'all'
  const page = Math.max(1, Number(one(params.page) ?? '1') || 1)

  const filters: ListingFilters = {
    cat: one(params.cat),
    loc: one(params.loc),
    price: one(params.price),
    size: one(params.size),
    feat: one(params.feat),
    az: one(params.az),
    trending: tab === 'trend',
    shuffle: tab === 'rand',
    page,
  }

  const [towns, counts, spotlight, results, day, week, month, movements, allCards, features] =
    await Promise.all([
    getTowns(),
    getCategoryCounts(),
    getSpotlightListings(3),
    getListings(filters),
    getTopListings('day'),
    getTopListings('week'),
    getTopListings('month'),
    getMarketMovements(),
    getAllCards(),
    getPopularFeatures(),
  ])

  const listings = results.listings
  const pages = Math.ceil(results.total / PAGE_SIZE)
  const status = describeFilters(filters, results.total, {
    price: PRICE_BANDS.find((band) => band.value === filters.price)?.label,
    size: SIZE_BANDS.find((band) => band.value === filters.size)?.label,
  })

  const initials = [...new Set(towns.map((town) => town.initial))].sort()
  const popularTowns = towns.slice(0, 8)

  return (
    <>
      <UtilityBar />
      <Header current="home" />
      <Sidebar features={features} />

      <HeroSpotlight listings={spotlight} />

      <SearchBar
        defaults={{ loc: filters.loc, cat: filters.cat, price: filters.price, size: filters.size }}
        towns={towns}
        status={
          showFavorites ? (
            <FavoritesStatus listings={allCards} />
          ) : status ? (
            <>
              <span>{status}</span> <Link href="/#listings">Clear filters</Link>
            </>
          ) : null
        }
      />

      <main id="main" className="wrap">
        <TypeTiles counts={counts} />

        <section id="listings" aria-labelledby="listH">
          <div className="sec-head center">
            <div>
              <h2 id="listH">{showFavorites ? 'Saved Properties' : 'Featured Listings'}</h2>
              <p>
                {showFavorites
                  ? 'The listings you tapped the heart on.'
                  : 'Fresh on the market across Mindanao.'}
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
                <Link className="btn btn-navy" href={withParams(params, { page: undefined })}>
                  Go to page 1
                </Link>
              </div>
            </div>
          ) : (
            <div className="empty">
              <b>No properties match your search</b>
              Try widening the price range or clearing a filter.
              <div>
                <Link className="btn btn-navy" href="/#listings">
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
        <VerifyBand />

        <section className="duo-wrap" aria-label="Top properties and market movements">
          <div className="duo">
            <TopProperties periods={{ day, week, month }} />
            <MarketMovements movements={movements} />
          </div>
        </section>

        <ContinueBrowsing listings={allCards} />
        <Testimonials />
        <RequestBand />
        <LocationsAndFaq
          initials={initials}
          popularTowns={popularTowns}
          activeInitial={filters.az?.toUpperCase()}
          activeTown={filters.loc}
        />
      </main>

      <Footer />
      <AuthDialog />
      <RequestDialog towns={towns.map((town) => town.name)} />
    </>
  )
}
