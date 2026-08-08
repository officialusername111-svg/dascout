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

  /* Still no amount in the metadata, even now that a price CAN be public (Phase D).
     Search results and link previews are cached and reshared far beyond the page, so a
     price that was switched on in March would keep circulating after it was switched off
     again. The page shows the current answer; the preview text does not carry one. */
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
    listing.categoryKey ? getSimilarListings(listing.categoryKey, listing.id) : Promise.resolve([]),
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
            {/* Phase D. Present only when staff switched this listing's price on; when
                they have not there is no line here at all and the specs move up (the
                owner's call, 2026-08-08 — no "price on request" placeholder). The value
                comes from the database's generated column, so a hidden amount has no
                route to this page even if something above it changed. */}
            {listing.priceLabel && <div className="prop-price">{listing.priceLabel}</div>}
            <div className="prop-specs">
              <Specs specs={listing.specs} />
            </div>

            {/*
              Phase C. `dangerouslySetInnerHTML` is safe HERE and only here, because this
              value cannot arrive unsanitised: `listingFieldsFrom` runs every description
              through `sanitizeDescriptionHtml` on the way IN, and the backfill that
              created this column escaped the plain text it came from. Never render a
              description that has not been through that filter, and never widen the
              filter's allowlist to make something on this page look better.

              `description` stays plain and is what the SEO meta above reads. The fallback
              is not defensive noise — a listing written before Phase C that has somehow
              not been backfilled still has its words, and showing them beats showing a
              gap where the description used to be.
            */}
            {(listing.descriptionHtml || listing.description) && (
              <>
                <h4>About this property</h4>
                {listing.descriptionHtml ? (
                  <div
                    className="desc"
                    dangerouslySetInnerHTML={{ __html: listing.descriptionHtml }}
                  />
                ) : (
                  <p className="desc">{listing.description}</p>
                )}
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
              {/* The second route to the same enquiry. `tel:` so a phone dials on tap;
                  the visible text keeps the spaces because a number read aloud over the
                  counter is the other half of what this is for. Same number the footer
                  carries — this one sits where the decision is being made. */}
              <a className="btn btn-ghost" href="tel:+639206685742">
                <Icon name="phone" /> +63 920 668 5742
              </a>
              <SaveButton slug={listing.slug} title={listing.title} />
            </div>
            {/* Sits under the enquiry actions on purpose: it qualifies them. DaScout is
                the only channel for this property, so a buyer who found the owner some
                other way is being told, here, that it does not work that way. */}
            <p className="cta-note">
              All inquiries for this property are handled exclusively through DaScout.
            </p>
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
