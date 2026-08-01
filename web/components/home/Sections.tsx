import Link from 'next/link'
import { Icon } from '@/components/Icon'
import { CreateAccountButton, RequestButton } from '@/components/home/Panels'
import { CATEGORIES, CATEGORY_KEYS, type CategoryKey } from '@/lib/categories'
import type { TownRow } from '@/lib/queries'

export function TypeTiles({ counts }: { counts: Record<CategoryKey, number> }) {
  return (
    <section id="types" aria-labelledby="typesH">
      <div className="sec-head center">
        <div>
          <h2 id="typesH">Explore Property Types</h2>
          <p>Five categories, all title-verified before listing.</p>
        </div>
      </div>
      <div className="types">
        {CATEGORY_KEYS.map((key) => {
          const count = counts[key]
          return (
            <Link className="type" key={key} href={`/?cat=${key}#listings`}>
              <span className="ic">
                <Icon name={CATEGORIES[key].icon} />
              </span>
              <b>{CATEGORIES[key].plural}</b>
              <span>
                {count} listing{count === 1 ? '' : 's'}
              </span>
            </Link>
          )
        })}
      </div>
      <div className="sec-foot">
        <Link className="viewall" href="/#listings">
          View all →
        </Link>
      </div>
    </section>
  )
}

/* Approved redesign: pure text — no row images. "How We Verify" points at the FAQ,
   which owns the verification answer now that the verify band is gone. */
const ABOUT_ROWS = [
  {
    icon: 'check',
    title: 'Verified Listings Only',
    body: 'Every property we feature is checked before it reaches you.',
    cta: { kind: 'link', label: 'See Verified Listings', href: '/#listings' },
  },
  {
    icon: 'target',
    title: 'Curated Matches',
    body: "Based on what you're actually looking for, not everything on the market.",
    cta: { kind: 'request', label: 'Request a Property' },
  },
  {
    icon: 'key',
    title: 'Direct Owner Access',
    body:
      'Every listing comes straight from the property owner, not resellers, so pricing and details stay accurate.',
    cta: { kind: 'link', label: 'How We Verify', href: '/#faq' },
  },
  {
    icon: 'star',
    title: 'Exclusive Opportunities',
    body: "These properties aren't seen anywhere else on the market.",
    cta: { kind: 'link', label: 'View Top Properties', href: '/#top' },
  },
  {
    icon: 'hand',
    title: 'Real Support',
    body: 'From your first inquiry to closing day, our team helps you through the process.',
    cta: { kind: 'account', label: 'Create a Free Account' },
  },
] as const

export function AboutRows() {
  return (
    <section aria-labelledby="aboutH">
      <div className="why">
        <div className="sec-head center" style={{ marginBottom: 16 }}>
          <div>
            <h2 id="aboutH">
              Here&rsquo;s what you can expect <em>from us</em>
            </h2>
            <p>
              Mindanao&rsquo;s exclusive, verified real estate platform, built for buyers who
              can&rsquo;t be everywhere at once.
            </p>
          </div>
        </div>
        <div className="features">
          {ABOUT_ROWS.map((row) => (
            <div className="frow" key={row.title}>
              <div className="ftext">
                <span className="ic">
                  <Icon name={row.icon} />
                </span>
                <b>{row.title}</b>
                <span>{row.body}</span>
                <div className="fcta">
                  {row.cta.kind === 'link' && (
                    <Link className="btn btn-ghost btn-sm" href={row.cta.href}>
                      {row.cta.label}
                    </Link>
                  )}
                  {row.cta.kind === 'request' && (
                    <RequestButton className="btn btn-ghost btn-sm">{row.cta.label}</RequestButton>
                  )}
                  {row.cta.kind === 'account' && (
                    <CreateAccountButton className="btn btn-ghost btn-sm">
                      {row.cta.label}
                    </CreateAccountButton>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const QUOTES = [
  {
    text:
      'Found our house near the plaza in three weeks. The title was already checked before we even inquired.',
    initials: 'RD',
    name: 'Rowena Dizon',
    role: 'First-time homebuyer · Koronadal',
    stars: 5,
  },
  {
    text:
      'DaScout is my morning coffee read. Caught two highway frontage lots the same week they went live.',
    initials: 'JM',
    name: 'Jomar Mercado',
    role: 'Property investor · General Santos',
    stars: 5,
  },
  {
    text:
      'As a DaScout partner broker, verification is fast and inquiries arrive with real intent. Best platform I’ve worked with.',
    initials: 'AS',
    name: 'Amira Santos',
    role: 'Partner broker · Kidapawan',
    stars: 5,
  },
  {
    text:
      'Bought two hectares for our family farm from abroad. The documents checked out exactly as listed.',
    initials: 'KT',
    name: 'Kevin Tan',
    role: 'Farm buyer · Tupi',
    stars: 4,
  },
]

export function Testimonials() {
  return (
    <section aria-labelledby="quotesH">
      <div className="sec-head center">
        <div>
          <h2 id="quotesH">What Our Clients Say</h2>
          <p>After finding their place through DaScout.</p>
        </div>
      </div>
      <div className="quotes">
        {QUOTES.map((quote) => (
          <div className="quote" key={quote.name}>
            <div className="qm" aria-hidden="true">
              &ldquo;
            </div>
            <p>{quote.text}</p>
            <div className="who">
              <span className="av" aria-hidden="true">
                {quote.initials}
              </span>
              <span>
                <b>{quote.name}</b>
                <span className="role">{quote.role}</span>
              </span>
              <span className="stars" aria-label={`${quote.stars} out of 5 stars`}>
                {'★'.repeat(quote.stars)}
                {'☆'.repeat(5 - quote.stars)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

const FAQS = [
  {
    q: 'How do I find the right property?',
    a:
      'Use the search bar above: pick a category and your town, then refine with size and feature filters. Create a free account to save favorites and compare them side by side.',
  },
  {
    q: 'What is the process of buying a property?',
    a:
      'Shortlist, inquire, and make an offer. Our team walks you through document verification (TCT/CCT, tax declarations, and for farm land the DAR clearance) before any reservation fee, all the way to turnover.',
  },
  {
    q: 'How are listings verified?',
    a:
      'Titles are checked at the Registry of Deeds and boundaries walked on-site before any listing goes live. What you see is what was verified on the ground.',
  },
]

export function LocationsAndFaq({
  initials,
  popularTowns,
  activeInitial,
  activeTown,
}: {
  initials: string[]
  popularTowns: TownRow[]
  activeInitial?: string
  activeTown?: string
}) {
  return (
    <section id="locations" aria-labelledby="locH">
      <div className="split2">
        <div>
          <div className="sec-head">
            <div>
              <h2 id="locH">Browse by Location</h2>
              <p>Mindanao cities and towns, A to Z.</p>
            </div>
          </div>
          <div className="azindex">
            <div className="az" role="group" aria-label="Filter listings by town initial">
              <Link href="/#listings" aria-current={!activeInitial && !activeTown ? 'true' : undefined}>
                All
              </Link>
              {initials.map((letter) => (
                <Link
                  key={letter}
                  href={`/?az=${letter}#listings`}
                  aria-current={activeInitial === letter ? 'true' : undefined}
                >
                  {letter}
                </Link>
              ))}
            </div>
            <p style={{ margin: '14px 0 8px', color: 'var(--ink-2)', fontSize: '13.5px' }}>
              Popular right now:
            </p>
            <div className="az" role="group" aria-label="Filter listings by town">
              {popularTowns.map((town) => (
                <Link
                  key={town.id}
                  href={`/?loc=${encodeURIComponent(town.name)}#listings`}
                  aria-current={activeTown === town.name ? 'true' : undefined}
                >
                  {town.name}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div id="faq">
          <div className="sec-head">
            <div>
              <h2>Frequently Asked Questions</h2>
              <p>Quick answers before you scout.</p>
            </div>
          </div>
          <div className="faq">
            {FAQS.map((faq, i) => (
              <details key={faq.q} open={i === 0}>
                <summary>
                  {faq.q} <Icon name="chev" />
                </summary>
                <div className="a">{faq.a}</div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
