import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Footer, Header, Sidebar, UtilityBar } from '@/components/Chrome'
import { AuthDialog, RequestDialog } from '@/components/Dialogs'
import { Icon } from '@/components/Icon'
import { ListingCardTile, Specs } from '@/components/ListingCard'
import { Gallery } from '@/components/property/Gallery'
import { RecordVisit } from '@/components/property/RecordVisit'
import { SaveButton } from '@/components/property/SaveButton'
import {
  getListingBySlug,
  getPopularFeatures,
  getSimilarListings,
  getTowns,
} from '@/lib/queries'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const listing = await getListingBySlug(slug)
  if (!listing) return { title: 'Listing not found' }

  const description =
    listing.description ??
    `${listing.categoryLabel} in ${listing.location}, ${listing.priceLabel}. Title-verified by DaScout.`

  return {
    title: listing.title,
    description,
    alternates: { canonical: `/property/${listing.slug}` },
    openGraph: {
      title: `${listing.title} — ${listing.priceLabel}`,
      description,
      type: 'article',
      images: listing.photo ? [{ url: listing.photo }] : undefined,
    },
  }
}

export default async function PropertyPage({ params }: Props) {
  const { slug } = await params
  const listing = await getListingBySlug(slug)
  if (!listing) notFound()

  const [similar, towns, features] = await Promise.all([
    getSimilarListings(listing.categoryKey, listing.id),
    getTowns(),
    getPopularFeatures(),
  ])

  const mailSubject = encodeURIComponent(`Inquiry: ${listing.title} (${listing.location})`)
  const mailBody = encodeURIComponent(
    `Hi DaScout,\n\nI'd like to inquire about "${listing.title}" listed at ${listing.priceLabel}.\n\nMy questions:\n\n`
  )
  const mapQuery = encodeURIComponent(`${listing.town}, ${listing.province}, Philippines`)

  return (
    <>
      <RecordVisit listingId={listing.id} slug={listing.slug} />
      <UtilityBar />
      <Header />
      <Sidebar features={features} />

      <main id="main" className="wrap">
        <Link className="crumb" href="/#listings">
          <Icon name="arrow-l" /> Back to listings
        </Link>

        <div className="prop-grid">
          <Gallery photos={listing.photos} title={listing.title} />

          <div className="prop-info">
            <span className="pill">{listing.categoryLabel}</span>
            <h1>{listing.title}</h1>
            <div className="loc">
              <Icon name="pin" /> {listing.location} · Mindanao
            </div>
            <div className="price">{listing.priceLabel}</div>
            <div className="prop-specs">
              <Specs specs={listing.specs} />
            </div>

            {listing.description && (
              <>
                <h4>About this property</h4>
                <p className="desc">{listing.description}</p>
              </>
            )}

            {listing.features.length > 0 && (
              <>
                <h4>Features</h4>
                <div className="feat-chips">
                  {listing.features.map((feature) => (
                    <span key={feature}>
                      <Icon name="check" />
                      {feature}
                    </span>
                  ))}
                </div>
              </>
            )}

            <div className="prop-cta">
              <a
                className="btn btn-navy"
                href={`mailto:hello@dascout.ph?subject=${mailSubject}&body=${mailBody}`}
              >
                <Icon name="mail" /> Inquire About This Property
              </a>
              <SaveButton slug={listing.slug} title={listing.title} />
            </div>
          </div>
        </div>

        <div className="mapblock">
          <div className="sec-head" style={{ marginBottom: 18 }}>
            <div>
              <h2>Location</h2>
              <p>
                {listing.location} — approximate area shown; exact boundaries walked during
                verification.
              </p>
            </div>
          </div>
          <div className="frame">
            <iframe
              title={`Map of ${listing.location}`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src={`https://www.google.com/maps?q=${mapQuery}&output=embed`}
            />
          </div>
        </div>

        {similar.length > 0 && (
          <section aria-labelledby="simH">
            <div className="sec-head">
              <div>
                <h2 id="simH">
                  Similar <em>Properties</em>
                </h2>
                <p>More in this category across Mindanao.</p>
              </div>
            </div>
            <div className="grid">
              {similar.map((item) => (
                <ListingCardTile key={item.slug} listing={item} showFavorite={false} />
              ))}
            </div>
          </section>
        )}
      </main>

      <Footer />
      <AuthDialog />
      <RequestDialog towns={towns.map((town) => town.name)} />
    </>
  )
}
