import type { Metadata } from 'next'
import Link from 'next/link'
import { ListingForm } from '@/components/admin/ListingForm'
import { getPropertyTypeOptions, getTownOptions } from '@/lib/admin/queries'

export const metadata: Metadata = { title: 'New listing' }

/**
 * Create is fields only. Photos, features, and status all need a listing id to hang
 * off, so they appear on the edit screen the action redirects to.
 */
export default async function NewListingPage() {
  const [towns, propertyTypes] = await Promise.all([getTownOptions(), getPropertyTypeOptions()])

  return (
    <>
      <Link className="crumb" href="/admin">
        ← Back to listings
      </Link>
      <h1>New listing</h1>
      <p className="lede">
        Saved to the list. Nothing reaches the public site until it&rsquo;s submitted for approval
        and approved.
      </p>

      <ListingForm mode="create" towns={towns} propertyTypes={propertyTypes} />
    </>
  )
}
