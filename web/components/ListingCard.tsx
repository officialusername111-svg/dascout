import Link from 'next/link'
import { Icon } from '@/components/Icon'
import { FavButton } from '@/components/FavButton'
import { displayTitle } from '@/lib/format'
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
 *
 * `sold` is the history page's sold treatment in card form (LH-5): the pill says Sold
 * and the card body is a plain span — the public property page is live-only, so a link
 * would 404. The heart stays so a sold favourite can still be unsaved.
 */
export function ListingCardTile({
  listing,
  seen,
  sold = false,
  showFavorite = true,
}: {
  listing: Listing
  seen?: string
  sold?: boolean
  showFavorite?: boolean
}) {
  const body = (
    <>
      <span className="ph">
        {listing.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img loading="lazy" decoding="async" src={listing.photo} alt={listing.photoAlt} />
        ) : (
          <span className="ph-empty" aria-hidden="true" />
        )}
        <span className={sold ? 'pill muted' : 'pill'}>
          {sold ? 'Sold' : listing.categoryLabel}
        </span>
      </span>
      <span className="bd">
        <h3>{displayTitle(listing.propertyNo, listing.title)}</h3>
        <span className="loc">
          <Icon name="pin" /> {listing.location}
        </span>
        {seen ? (
          <span className="seen">{seen}</span>
        ) : (
          <span className="specs">
            <Specs specs={listing.specs} />
          </span>
        )}
      </span>
    </>
  )

  return (
    <div className="card" data-cat={listing.categoryKey}>
      {sold ? (
        <span className="cardlink">{body}</span>
      ) : (
        <Link className="cardlink" href={`/property/${listing.slug}`}>
          {body}
        </Link>
      )}
      {showFavorite && <FavButton slug={listing.slug} title={listing.title} />}
    </div>
  )
}
