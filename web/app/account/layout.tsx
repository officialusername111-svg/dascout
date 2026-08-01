import type { Metadata } from 'next'
import { Header, Sidebar, Footer } from '@/components/Chrome'
import { AuthDialog } from '@/components/Dialogs'
import { requireAccountUser } from '@/lib/account/auth'
import { getPopularFeatures } from '@/lib/queries'

/**
 * The account section, inside the ordinary public chrome.
 *
 * `requireAccountUser()` here is the user-experience layer: it sends a signed-out visitor
 * back to the home page — where the sign-in dialog lives — instead of rendering an empty
 * shell, and it does so before any child page starts fetching. It is NOT the security
 * boundary. Every query function and every action re-checks independently, because a
 * layout only decides what a browser is shown; it does not stand between a hand-written
 * POST and the database.
 *
 * `noindex` sits at this level so it covers every child page and no child sets its own —
 * one place to read, one place to change. It is backed by an `X-Robots-Tag` header in
 * `next.config.ts` and a `robots.txt` disallow, because a crawler that never renders the
 * page still sees the header.
 */
export const metadata: Metadata = {
  title: { default: 'Your account', template: '%s · Your account' },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
}

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  await requireAccountUser()
  const features = await getPopularFeatures()

  return (
    <>
      <Header />
      <Sidebar features={features} />

      <main id="main" className="wrap" style={{ paddingBottom: 64 }}>
        {children}
      </main>

      <Footer />
      <AuthDialog />
    </>
  )
}
