import type { Metadata } from 'next'
import { getSettingsLists } from '@/lib/admin/queries'
import { SettingsPanels } from '@/components/admin/SettingsPanels'

export const metadata: Metadata = { title: 'Settings' }

/**
 * The lookup lists every listing draws from: property types, towns and features.
 *
 * All three are read here, on the server, in one guarded call — including the per-row
 * count of listings pointing at each one, which is what lets the screen disable a delete
 * before it is pressed rather than explaining a foreign-key error afterwards.
 *
 * Open to every staff account, like Listings and Requests and unlike Admins. These are the
 * words the office uses for its own properties, not an access decision: anybody trusted to
 * publish a listing is trusted to name a town.
 */
export default async function AdminSettingsPage() {
  const lists = await getSettingsLists()

  return (
    <>
      <h1>Settings</h1>
      <p className="lede">
        Property types, towns and features — the lookup lists every listing draws from.
      </p>

      <SettingsPanels lists={lists} />
    </>
  )
}
