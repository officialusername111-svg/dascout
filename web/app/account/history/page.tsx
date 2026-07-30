import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAccountUser } from '@/lib/account/auth'
import { getAccountHistory, getPublicListingTitles } from '@/lib/account/queries'
import { HistoryList } from '@/components/account/HistoryList'

export const metadata: Metadata = { title: 'Browsing history' }

/**
 * Browsing history, and a plain statement of what is kept and who can see it.
 *
 * The privacy sentence is on the screen rather than in a policy page nobody opens,
 * because the thing being disclosed is not obvious: view rows exist for anonymous
 * visitors too, and signing in is what attaches a name to them. The clear control sits
 * directly beside that sentence, so the disclosure and the remedy arrive together.
 */
export default async function AccountHistoryPage() {
  await requireAccountUser()
  const [entries, titles] = await Promise.all([getAccountHistory(), getPublicListingTitles()])

  return (
    <>
      <h1 style={{ fontSize: 'clamp(23px, 3vw, 31px)', margin: '26px 0 4px' }}>Browsing history</h1>
      <p className="amuted" style={{ marginBottom: 20 }}>
        The last 50 properties you opened. <Link href="/account">Back to your account</Link>
      </p>

      <section className="apanel">
        <HistoryList accountEntries={entries} titles={titles} />
      </section>
    </>
  )
}
