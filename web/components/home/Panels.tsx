'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/Icon'
import { ListingCardTile } from '@/components/ListingCard'
import { useUI } from '@/components/ui-state'
import { compactCount, shortPeso, timeAgo } from '@/lib/format'
import type { ListingCard, MarketMovements as Movements, TopListing, TopPeriod } from '@/lib/queries'

/** "Residential Lot · 240 sqm · Titled" — the small grey line under a ranked row. */
function metaLine(listing: ListingCard): string {
  return [listing.categoryLabel, ...listing.specs.map((s) => s.text)].join(' · ')
}

export function TopProperties({
  periods,
}: {
  periods: Record<TopPeriod, TopListing[]>
}) {
  const [period, setPeriod] = useState<TopPeriod>('day')
  const listings = periods[period]
  const anyViews = listings.some((listing) => listing.views > 0)

  return (
    <section id="top" aria-labelledby="topH">
      <div className="sec-head">
        <div>
          <h2 id="topH">Top Properties</h2>
          <p>{anyViews ? 'Most viewed by fellow scouts.' : 'Trending now — view counts start as visitors browse.'}</p>
        </div>
        <div className="tabs">
          {(['day', 'week', 'month'] as TopPeriod[]).map((value) => (
            <button
              key={value}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {value === 'day' ? 'Day' : value === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
      </div>

      <div className="toplist">
        {listings.map((listing, i) => (
          <Link className="topitem" key={listing.slug} href={`/property/${listing.slug}`}>
            <span className="rank" aria-hidden="true">
              {i + 1}
            </span>
            {listing.photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img loading="lazy" decoding="async" src={listing.photo} alt="" />
            )}
            <span className="t">
              <b>{listing.title}</b>
              <span>{listing.location}</span>
              <span className="meta">{metaLine(listing)}</span>
            </span>
            <span className="pv">
              <b>{listing.shortPrice}</b>
              {listing.views > 0 && (
                <span className="views">
                  {compactCount(listing.views)} view{listing.views === 1 ? '' : 's'}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function MarketRow({ listing, price }: { listing: ListingCard; price: React.ReactNode }) {
  return (
    <Link className="rowitem" href={`/property/${listing.slug}`}>
      {listing.photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img loading="lazy" decoding="async" src={listing.photo} alt="" />
      )}
      <span className="t">
        <b>{listing.title}</b>
        <span>
          {listing.town} · {listing.categoryLabel}
        </span>
        <span className="meta">{listing.specs.map((s) => s.text).join(' · ')}</span>
      </span>
      {price}
    </Link>
  )
}

export function MarketMovements({ movements }: { movements: Movements }) {
  const [panel, setPanel] = useState(0)
  const tabs = ['New listings', 'Price reduced', 'Just sold']

  return (
    <section id="market" aria-labelledby="marketH">
      <div className="sec-head">
        <div>
          <h2 id="marketH">
            Market <em>Movements</em>
          </h2>
          <p>What&rsquo;s new, what dropped, and what&rsquo;s gone.</p>
        </div>
        <div className="tabs">
          {tabs.map((label, i) => (
            <button key={label} aria-pressed={panel === i} onClick={() => setPanel(i)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="market">
        <div className={`col${panel === 0 ? ' on' : ''}`}>
          {movements.fresh.map((listing) => (
            <MarketRow
              key={listing.slug}
              listing={listing}
              price={<span className="p">{listing.shortPrice}</span>}
            />
          ))}
        </div>

        <div className={`col${panel === 1 ? ' on' : ''}`}>
          {movements.reduced.length ? (
            movements.reduced.map((listing) => (
              <MarketRow
                key={listing.slug}
                listing={listing}
                price={
                  <span className="p was">
                    <s>{shortPeso(listing.previousPrice)}</s>
                    <b>{listing.shortPrice}</b>
                    <em className="drop">{listing.dropPercent}% off</em>
                  </span>
                }
              />
            ))
          ) : (
            <div className="rowitem-empty">
              <b>No price drops yet</b>
              Every price change is recorded from now on, and the ones that go down show up here.
            </div>
          )}
        </div>

        <div className={`col${panel === 2 ? ' on' : ''}`}>
          {movements.sold.length ? (
            movements.sold.map((listing) => (
              <div className="rowitem" key={listing.slug}>
                {listing.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img loading="lazy" decoding="async" src={listing.photo} alt="" />
                )}
                <span className="t">
                  <b>{listing.title}</b>
                  <span>
                    {listing.town} · {listing.categoryLabel}
                  </span>
                  <span className="meta">{listing.specs.map((s) => s.text).join(' · ')}</span>
                </span>
                <span className="p sold">
                  <em>Sold</em>
                  {listing.shortPrice}
                </span>
              </div>
            ))
          ) : (
            <div className="rowitem-empty">
              <b>Nothing sold yet</b>
              Closed sales appear here once a listing is marked sold.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export function ContinueBrowsing({ listings }: { listings: ListingCard[] }) {
  const { history, clearHistory } = useUI()
  const seen = history
    .map((entry) => ({ listing: listings.find((l) => l.slug === entry.slug), at: entry.at }))
    .filter((row): row is { listing: ListingCard; at: number } => Boolean(row.listing))
    .slice(0, 3)

  return (
    <section id="resume" aria-labelledby="resumeH">
      <div className="sec-head">
        <div>
          <h2 id="resumeH">Continue Browsing</h2>
          <p>Pick up where you left off.</p>
        </div>
        {seen.length > 0 && (
          <button className="viewall" onClick={clearHistory}>
            Clear history
          </button>
        )}
      </div>
      {seen.length ? (
        <div className="grid">
          {seen.map(({ listing, at }) => (
            <ListingCardTile
              key={listing.slug}
              listing={listing}
              seen={`Viewed ${timeAgo(at)}`}
            />
          ))}
        </div>
      ) : (
        <div className="empty">
          <b>Nothing viewed yet</b>
          Properties you open will appear here so you can pick up where you left off.
        </div>
      )}
    </section>
  )
}

/** The favourites view: saved slugs live in the browser, so the browser filters them. */
export function FavoritesGrid({ listings }: { listings: ListingCard[] }) {
  const { favorites } = useUI()
  const saved = listings.filter((listing) => favorites.includes(listing.slug))

  if (!saved.length) {
    return (
      <div className="empty">
        <b>No saved properties yet</b>
        Tap the heart on any listing and it will wait for you here.
        <div>
          <Link className="btn btn-navy" href="/#listings">
            Browse all listings
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="grid">
      {saved.map((listing) => (
        <ListingCardTile key={listing.slug} listing={listing} />
      ))}
    </div>
  )
}

export function FavoritesStatus({ listings }: { listings: ListingCard[] }) {
  const { favorites } = useUI()
  const count = listings.filter((listing) => favorites.includes(listing.slug)).length
  return (
    <>
      <span>
        {count} propert{count === 1 ? 'y' : 'ies'} · your favorites
      </span>{' '}
      <Link href="/#listings">Clear filters</Link>
    </>
  )
}

export function RequestBand() {
  const { openRequest } = useUI()
  return (
    <section aria-labelledby="reqH">
      <div className="reqband">
        <Icon name="search" />
        <div>
          <h2 id="reqH">
            Can&rsquo;t find it? <em>Request it.</em>
          </h2>
          <p>
            Tell us what you&rsquo;re looking for and we&rsquo;ll notify you when a matching verified
            listing goes live.
          </p>
        </div>
        <button className="btn btn-gold" onClick={openRequest}>
          Request a Property
        </button>
      </div>
    </section>
  )
}

export function RequestButton({ className, children }: { className: string; children: React.ReactNode }) {
  const { openRequest } = useUI()
  return (
    <button className={className} onClick={openRequest}>
      {children}
    </button>
  )
}

export function CreateAccountButton({
  className,
  children,
}: {
  className: string
  children: React.ReactNode
}) {
  const { openAuth } = useUI()
  return (
    <button className={className} onClick={() => openAuth('register')}>
      {children}
    </button>
  )
}
