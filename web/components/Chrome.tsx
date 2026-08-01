'use client'

import Link from 'next/link'
import { Icon } from '@/components/Icon'
import { useUI } from '@/components/ui-state'
import { CATEGORIES, CATEGORY_KEYS } from '@/lib/categories'

/**
 * The header, in one of two states.
 *
 * Signed out it is exactly the approved mockup: a heart, "Sign In", "Create Account".
 * Signed in, the two buttons become a single Account link — the sign-out control lives on
 * the account page rather than one tap from every listing — and the heart points at the
 * account's saved properties instead of the browser-filtered view of the home page.
 */
export function Header({ current }: { current?: 'home' }) {
  const { openSidebar, sidebarOpen, favorites, openAuth, toast, accountUserId, accountName } =
    useUI()
  const signedIn = Boolean(accountUserId)

  return (
    <header>
      <div className="hd">
        <button
          className="burger"
          aria-label="Open menu"
          aria-expanded={sidebarOpen}
          aria-controls="sidebar"
          onClick={openSidebar}
        >
          <span />
          <span />
          <span />
        </button>
        <Link className="logo" href="/" aria-label="DaScout home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo-img" src="/assets/dascout-logo.png" alt="DaScout" />
        </Link>
        <nav className="main" aria-label="Primary">
          <Link href="/" aria-current={current === 'home' ? 'page' : undefined}>
            Home
          </Link>
          <Link href="/?cat=lots#listings">Lots</Link>
          <Link href="/?cat=farm#listings">Farm Land</Link>
          <Link href="/?cat=bldgs#listings">Buildings</Link>
          <Link href="/#locations">Locations</Link>
          <Link href="/#faq">FAQ</Link>
        </nav>
        <div className="hd-actions">
          <Link
            className="iconbtn"
            href={signedIn ? '/account/favorites' : '/?favs=1#listings'}
            aria-label="Saved favorites"
            onClick={(event) => {
              if (!signedIn && favorites.length === 0) {
                event.preventDefault()
                toast('No favorites yet — tap the heart on any listing to save it')
              }
            }}
          >
            <Icon name="heart" />
            {favorites.length > 0 && <span className="cnt">{favorites.length}</span>}
          </Link>
          {signedIn ? (
            <Link className="btn btn-gold" href="/account">
              {accountName ?? 'Account'}
            </Link>
          ) : (
            <>
              <button className="signin" onClick={() => openAuth('login')}>
                Sign In
              </button>
              <button className="btn btn-gold" onClick={() => openAuth('register')}>
                Create Account
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export function Sidebar({ features }: { features: string[] }) {
  const { sidebarOpen, closeSidebar, openRequest, accountUserId } = useUI()

  return (
    <>
      <div
        className={`scrim${sidebarOpen ? ' on' : ''}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />
      <nav className={`sidebar${sidebarOpen ? ' open' : ''}`} id="sidebar" aria-label="Menu">
        <div className="sb-top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo-img" src="/assets/dascout-logo.png" alt="DaScout" />
          <button className="sb-close" aria-label="Close menu" onClick={closeSidebar}>
            <Icon name="x" />
          </button>
        </div>

        {accountUserId && (
          <>
            <div className="sb-title">Your account</div>
            <div className="sb-links">
              <Link href="/account" onClick={closeSidebar}>Account overview</Link>
              <Link href="/account/favorites" onClick={closeSidebar}>Saved properties</Link>
              <Link href="/account/history" onClick={closeSidebar}>Browsing history</Link>
            </div>
          </>
        )}

        <div className="sb-title">Browse</div>
        <div className="sb-links">
          <Link href="/" onClick={closeSidebar}>Home</Link>
          <Link href="/#listings" onClick={closeSidebar}>Featured listings</Link>
          <Link href="/#top" onClick={closeSidebar}>Top properties</Link>
          <Link href="/#locations" onClick={closeSidebar}>Locations</Link>
          <Link href="/#faq" onClick={closeSidebar}>FAQ</Link>
        </div>

        <div className="sb-title">Property types</div>
        <div className="sb-links">
          {CATEGORY_KEYS.map((key) => (
            <Link key={key} href={`/?cat=${key}#listings`} onClick={closeSidebar}>
              {CATEGORIES[key].label}
            </Link>
          ))}
        </div>

        {features.length > 0 && (
          <>
            <div className="sb-title">Features</div>
            <div className="sb-feat">
              {features.map((feature) => (
                <Link
                  key={feature}
                  href={`/?feat=${encodeURIComponent(feature)}#listings`}
                  onClick={closeSidebar}
                >
                  {feature}
                </Link>
              ))}
            </div>
          </>
        )}

        <div className="sb-title">More</div>
        <div className="sb-links">
          <button
            onClick={() => {
              closeSidebar()
              openRequest()
            }}
          >
            Request a property
          </button>
        </div>
      </nav>
    </>
  )
}

export function Footer() {
  const { openRequest } = useUI()

  return (
    <footer>
      <div className="foot">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo-img" src="/assets/dascout-logo.png" alt="DaScout" />
          <p>
            Mindanao&rsquo;s exclusive, verified real estate platform. Every listing title-checked,
            boundary-walked, and confirmed on the ground before it reaches you.
          </p>
        </div>
        <div>
          <h4>Quick Links</h4>
          <Link href="/">Home</Link>
          <Link href="/#listings">Featured listings</Link>
          <Link href="/#locations">Locations</Link>
          <Link href="/#faq">FAQ</Link>
          <button onClick={openRequest}>Request a property</button>
        </div>
        <div>
          <h4>Property Types</h4>
          {CATEGORY_KEYS.map((key) => (
            <Link key={key} href={`/?cat=${key}#listings`}>
              {CATEGORIES[key].plural}
            </Link>
          ))}
        </div>
        <div className="contact">
          <h4>Contact Us</h4>
          <div>
            <Icon name="pin" /> General Santos City, Mindanao
          </div>
          <div>
            <Icon name="phone" /> +63 (83) 552 0000
          </div>
          <div>
            <Icon name="mail" /> hello@dascout.ph
          </div>
        </div>
      </div>
      <p className="copy">
        © DaScout. All rights reserved. All listings are sourced, title-checked, and verified by
        DaScout before publication. DaScout is a listing platform and is not a party to any
        transaction; verify all property documents (TCT/CCT, tax declarations) before paying any
        reservation fee.
      </p>
    </footer>
  )
}
