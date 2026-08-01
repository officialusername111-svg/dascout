import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAccountUser } from '@/lib/account/auth'
import { getAccountFavorites } from '@/lib/account/queries'
import { ListingCardTile } from '@/components/ListingCard'
import { UnresolvedFavoritesNote } from '@/components/account/AccountSync'

export const metadata: Metadata = { title: 'Saved properties' }

/**
 * The account's saved properties, as the same cards the rest of the site renders.
 *
 * The grid shows what the account holds and can display. The grey line above it — how
 * many saved properties are not currently listed — can only come from the browser: a
 * favourite whose listing has gone back to draft is hidden from this session by
 * row-level security, so the server genuinely cannot count them. Leaving it unsaid would
 * look as though the site had quietly lost somebody's saved property.
 */
export default async function AccountFavoritesPage() {
  const user = await requireAccountUser()
  const listings = await getAccountFavorites()

  return (
    <>
      <h1 style={{ fontSize: 'clamp(23px, 3vw, 31px)', margin: '26px 0 4px' }}>Saved properties</h1>
      <p className="amuted" style={{ marginBottom: 20 }}>
        {listings.length} propert{listings.length === 1 ? 'y' : 'ies'} saved to your account.{' '}
        <Link href="/account">Back to your account</Link>
      </p>

      <section className="apanel">
        <UnresolvedFavoritesNote userId={user.id} />

        {listings.length ? (
          <div className="grid">
            {listings.map(({ card, sold }) => (
              <ListingCardTile key={card.slug} listing={card} sold={sold} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <b>No saved properties yet</b>
            Tap the heart on any listing and it will wait for you here, on every device you sign in
            from.
            <div>
              <Link className="btn btn-navy" href="/#listings">
                Browse all listings
              </Link>
            </div>
          </div>
        )}
      </section>
    </>
  )
}
