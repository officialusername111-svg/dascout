import type { Metadata } from 'next'
import { Figtree, Playfair_Display } from 'next/font/google'
import './globals.css'
import { IconSprite } from '@/components/IconSprite'
import { UIProvider } from '@/components/ui-state'
import { AccountSync } from '@/components/account/AccountSync'
import { getAccountIdentity } from '@/lib/account/auth'
import { SITE_URL } from '@/lib/site'

const figtree = Figtree({
  variable: '--font-figtree',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

const playfair = Playfair_Display({
  variable: '--font-playfair',
  subsets: ['latin'],
  style: ['normal', 'italic'],
  weight: ['500', '600', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'DaScout — Verified Properties for Sale Across Mindanao',
    template: '%s — DaScout',
  },
  description:
    'Every listing is title-verified at the Registry of Deeds and boundary-walked on site before it reaches you. Lots, farm land and buildings for sale across Mindanao.',
  openGraph: {
    type: 'website',
    siteName: 'DaScout',
    locale: 'en_PH',
  },
}

/**
 * Reading the identity here is what makes the whole account section work without a
 * client-side auth store: every page under this layout, public or not, knows whether
 * somebody is signed in, so the header can say so and `AccountSync` can run its merge
 * from wherever the visitor happens to be standing when they sign in.
 *
 * It also makes this layout dynamic. That is accepted rather than incidental: the pages
 * beneath it already read cookies through the Supabase SSR client, so the change is to
 * the build output's shape rather than to how anything is served.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const identity = await getAccountIdentity()
  const user = identity.state === 'signed-in' ? identity.user : null

  return (
    <html lang="en" className={`${figtree.variable} ${playfair.variable}`}>
      <body>
        <IconSprite />
        <a className="skip" href="#main">
          Skip to main content
        </a>
        <UIProvider accountUserId={user?.id ?? null} accountName={user?.fullName ?? null}>
          {children}
        </UIProvider>
        <AccountSync userId={user?.id ?? null} />
      </body>
    </html>
  )
}
