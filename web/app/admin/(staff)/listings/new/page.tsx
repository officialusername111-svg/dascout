import type { Metadata } from 'next'
import Link from 'next/link'
import { ListingForm } from '@/components/admin/ListingForm'
import { getTownOptions } from '@/lib/admin/queries'

export const metadata: Metadata = { title: 'New listing' }

/**
 * Create is fields only. Photos, features, verification and publishing all need a
 * listing id to hang off, so they appear on the edit screen the action redirects to.
 */
export default async function NewListingPage() {
  const towns = await getTownOptions()

  return (
    <>
      <Link className="crumb" href="/admin">
        ← Back to listings
      </Link>
      <h1>New listing</h1>
      <p className="lede">
        Saved as a draft. Nothing reaches the public site until the verification record is complete
        and someone publishes it.
      </p>

      <ListingForm mode="create" towns={towns} />
    </>
  )
}
