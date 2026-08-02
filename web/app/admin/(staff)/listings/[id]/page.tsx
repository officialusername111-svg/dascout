import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FeaturesForm } from '@/components/admin/FeaturesForm'
import { LifecyclePanel } from '@/components/admin/LifecyclePanel'
import { ListingForm } from '@/components/admin/ListingForm'
import { PhotoManager } from '@/components/admin/PhotoManager'
import { VerificationPanel } from '@/components/admin/VerificationPanel'
import {
  getAdminListingDetail,
  getFeatureOptions,
  getTownOptions,
} from '@/lib/admin/queries'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const listing = await getAdminListingDetail(id)
  return { title: listing ? listing.title : 'Listing not found' }
}

/**
 * The one screen where a listing is actually worked on: fields, features, photos, the
 * verification record and the lifecycle controls, in the order the work happens.
 *
 * Everything the client components need is computed here — which bucket uploads go to,
 * whether the slug may still change, which moves exist from this status, and what is
 * blocking a publish. None of those are decisions a browser gets to make, and each is
 * re-derived inside the action before anything is written.
 */
export default async function EditListingPage({ params }: Props) {
  const { id } = await params

  const [listing, towns, features] = await Promise.all([
    getAdminListingDetail(id),
    getTownOptions(),
    getFeatureOptions(),
  ])

  if (!listing) notFound()

  return (
    <>
      <Link className="crumb" href="/admin">
        ← Back to listings
      </Link>

      <h1>{listing.title}</h1>
      <p className="lede">
        <span className={listing.status === 'live' ? 'pill ok' : 'pill muted'}>
          {listing.statusLabel}
        </span>{' '}
        {listing.categoryLabel} · {listing.townLabel} · {listing.priceLabel}
        {listing.updatedAtLabel ? ` · last changed ${listing.updatedAtLabel}` : ''}
        {listing.status === 'live' || listing.status === 'sold' ? (
          <>
            {' · '}
            <Link href={`/property/${listing.slug}`}>View the public page</Link>
          </>
        ) : null}
      </p>

      <ListingForm
        mode="edit"
        towns={towns}
        slugEditable={listing.slugEditable}
        statusLabel={listing.statusLabel}
        listing={{
          id: listing.id,
          slug: listing.slug,
          propertyNo: listing.propertyNo,
          title: listing.title,
          category: listing.category,
          pricePhp: listing.pricePhp,
          townId: listing.townId,
          areaDetail: listing.areaDetail,
          lotAreaSqm: listing.lotAreaSqm,
          floorAreaSqm: listing.floorAreaSqm,
          bedrooms: listing.bedrooms,
          bathrooms: listing.bathrooms,
          description: listing.description,
          isTrending: listing.isTrending,
        }}
      />

      <FeaturesForm
        listingId={listing.id}
        features={features}
        selectedIds={listing.featureIds}
      />

      <PhotoManager
        listingId={listing.id}
        status={listing.status}
        uploadBucket={listing.uploadBucket}
        photos={listing.photos}
      />

      <VerificationPanel listingId={listing.id} events={listing.events} />

      <LifecyclePanel
        listingId={listing.id}
        status={listing.status}
        statusLabel={listing.statusLabel}
        transitions={listing.allowedTransitions}
        publishedAtLabel={listing.publishedAtLabel}
        soldAtLabel={listing.soldAtLabel}
      />
    </>
  )
}
