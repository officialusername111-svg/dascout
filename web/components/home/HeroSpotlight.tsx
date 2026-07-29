'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/Icon'
import type { ListingCard } from '@/lib/queries'

const ROTATE_MS = 6000

/** The hero photo cycles through the featured listings, exactly as the mockup did. */
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

  const go = useCallback((next: number) => setIndex(next), [])

  const current = listings[index]
  if (!current) return null

  return (
    <div className="hero">
      <div className="in">
        <div className="hero-copy">
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
            <Link className="btn btn-ghost" href="/#verify">
              How We Verify
            </Link>
          </div>
        </div>

        <div
          className="ph"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
        >
          <Link
            className="cardlink"
            href={`/property/${current.slug}`}
            aria-label={`${current.title}, ${current.location}, ${current.priceLabel}`}
          />
          {current.photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.photo} alt={`${current.title} photo`} />
          )}

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

          <span className="spotcard" aria-live="polite">
            <span className="ic">
              <Icon name="home" />
            </span>
            <span className="t">
              <b>{current.title}</b>
              <span>{current.location}</span>
            </span>
            <span className="price">{current.shortPrice}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
