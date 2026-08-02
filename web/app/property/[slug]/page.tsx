import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Footer, Header, Sidebar } from '@/components/Chrome'
import { AuthDialog } from '@/components/Dialogs'
import { Icon } from '@/components/Icon'
import { ListingCardTile, Specs } from '@/components/ListingCard'
import { Gallery } from '@/components/property/Gallery'
import { RecordVisit } from '@/components/property/RecordVisit'
import { SaveButton } from '@/components/property/SaveButton'
import { displayTitle } from '@/lib/format'
import {
  getListingBySlug,
  getPopularFeatures,
  getSimilarListings,
} from '@/lib/queries'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const listing = await getListingBySlug(slug)
  if (!listing) return { title: 'Listing not found' }

  /* No amounts in public metadata either — prices are an admin-only surface. */
  const description =
    listing.description ??
    `${listing.categoryLabel} in ${listing.location}. Title-verified by DaScout.`

  // The reference leads here too, so a shared link and a browser tab both carry it.
  const heading = displayTitle(listing.propertyNo, listing.title)

  return {
    title: heading,
    description,
    alternates: { canonical: `/property/${listing.slug}` },
    openGraph: {
      title: heading,
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

  const [similar, features] = await Promise.all([
    getSimilarListings(listing.categoryKey, listing.id),
    getPopularFeatures(),
  ])

  // The enquiry names the listing exactly as the page does, reference first. Putting it
  // where staff will actually read it is the whole reason the number was made public — an
  // enquiry that leads with the reference can be matched without guessing from the title.
  const named = displayTitle(listing.propertyNo, listing.title)
  const mailSubject = encodeURIComponent(`Inquiry: ${named} (${listing.location})`)
  const mailBody = encodeURIComponent(
    `Hi DaScout,\n\nI'd like to inquire about "${named}" in ${listing.location}.\n\nMy questions:\n\n`
  )

  return (
    <>
      <RecordVisit listingId={listing.id} slug={listing.slug} />
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
            {/* The reference leads the title — "001 - Dacera Heights Corner Lot" — so it
                is the first thing read and the first thing quoted back. A listing without
                one shows its title alone rather than a dangling separator. */}
            <h1>{displayTitle(listing.propertyNo, listing.title)}</h1>
            <div className="loc">
              <Icon name="pin" /> {listing.location} · Mindanao
            </div>
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
                className="btn btn-dark"
                href={`mailto:dascoutph@gmail.com?subject=${mailSubject}&body=${mailBody}`}
              >
                <Icon name="mail" /> Inquire About This Property
              </a>
              <SaveButton slug={listing.slug} title={listing.title} />
            </div>
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
    </>
  )
}
