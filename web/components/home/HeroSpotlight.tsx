'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/Icon'
import { FavButton } from '@/components/FavButton'
import { Specs } from '@/components/ListingCard'
import type { ListingCard } from '@/lib/queries'

const ROTATE_MS = 6000

/**
 * The approved hero: the night-building photo is the backdrop (CSS on `.hero`), and the
 * featured listings rotate through a glass card on the left, under the headline. The
 * card shows photo, category, title, location and specs — never the price; amounts are
 * an admin-only surface.
 */
export function HeroSpotlight({ listings }: { listings: ListingCard[] }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const reduced = useRef(false)

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced.current) setPaused(true)
  }, [])

  const stopped = paused || hovered || listings.length < 2

  useEffect(() => {
    if (stopped) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % listings.length), ROTATE_MS)
    return () => clearInterval(timer)
  }, [stopped, listings.length])

  useEffect(() => {
    const onVisibility = () => setHovered(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  /* A hand-picked slide stops the rotation — on touch there is no hover to hold it. */
  const go = useCallback((next: number) => {
    setIndex(next)
    setPaused(true)
  }, [])

  const current = listings[index]

  return (
    <div className="hero">
      <div className="in">
        <div>
          <span className="label">100% Title-Verified Listings</span>
          <h1>
            Own a Property <em>Across Mindanao</em>
          </h1>
          <p className="sub">
            Every listing title-verified at the Registry of Deeds — before it ever reaches you. Buy
            with confidence, wherever you are.
          </p>
          <div className="ctas">
            <Link className="btn btn-gold" href="/#listings">
              See Verified Listings <Icon name="arrow" />
            </Link>
            <Link className="btn btn-ghost" href="/#faq">
              How We Verify
            </Link>
          </div>

          {current && (
            <div
              className="glasscard"
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              onFocus={() => setHovered(true)}
              onBlur={() => setHovered(false)}
            >
              <Link
                className="cardlink"
                href={`/property/${current.slug}`}
                aria-label={`${current.title}, ${current.location}`}
              />
              <FavButton slug={current.slug} title={current.title} />

              {/* Live only while still: announcing every auto-rotation would chatter at
                  screen readers indefinitely (the virtual cursor never fires onFocus). */}
              <span className="snap" aria-live={stopped ? 'polite' : 'off'}>
                {current.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={current.photo} alt={`${current.title} photo`} />
                )}
                <span className="t">
                  <span className="cat">Featured · {current.categoryLabel}</span>
                  <b>{current.title}</b>
                  <span className="loc">
                    <Icon name="pin" /> {current.location}
                  </span>
                </span>
              </span>

              <span className="specs">
                <Specs specs={current.specs} />
              </span>

              <span className="spot-ctrl">
                {listings.map((listing, i) => (
                  <button
                    key={listing.slug}
                    className="dot"
                    aria-pressed={i === index}
                    aria-label={`Featured property ${i + 1}`}
                    onClick={() => go(i)}
                  />
                ))}
                <button
                  aria-pressed={paused}
                  aria-label={paused ? 'Resume featured rotation' : 'Pause featured rotation'}
                  onClick={() => setPaused((value) => !value)}
                >
                  <Icon name={paused ? 'play' : 'pause'} />
                </button>
              </span>
            </div>
          )}
        </div>
        <div aria-hidden="true" />
      </div>
    </div>
  )
}
