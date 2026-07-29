import Link from 'next/link'
import { Icon } from '@/components/Icon'
import { FavButton } from '@/components/FavButton'
import type { ListingCard as Listing, Spec } from '@/lib/queries'

export function Specs({ specs }: { specs: Spec[] }) {
  return (
    <>
      {specs.map((spec) => (
        <span key={spec.text}>
          {spec.icon && <Icon name={spec.icon} />}
          {spec.text}
        </span>
      ))}
    </>
  )
}

/**
 * The square photo card used by the featured grid, the favourites view and the
 * similar-properties row. `seen` replaces the spec chips in "Continue browsing".
 */
export function ListingCardTile({
  listing,
  seen,
  showFavorite = true,
}: {
  listing: Listing
  seen?: string
  showFavorite?: boolean
}) {
  return (
    <div className="card" data-cat={listing.categoryKey}>
      <Link className="cardlink" href={`/property/${listing.slug}`}>
        <span className="ph">
          {listing.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img loading="lazy" decoding="async" src={listing.photo} alt={listing.photoAlt} />
          ) : (
            <span className="ph-empty" aria-hidden="true" />
          )}
          <span className="pill">{listing.categoryLabel}</span>
        </span>
        <span className="bd">
          <h3>{listing.title}</h3>
          <span className="loc">
            <Icon name="pin" /> {listing.location}
          </span>
          <span className="price">{listing.priceLabel}</span>
          {seen ? (
            <span className="seen">{seen}</span>
          ) : (
            <span className="specs">
              <Specs specs={listing.specs} />
            </span>
          )}
        </span>
      </Link>
      {showFavorite && <FavButton slug={listing.slug} title={listing.title} />}
    </div>
  )
}
