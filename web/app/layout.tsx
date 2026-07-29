import type { Metadata } from 'next'
import { Figtree, Playfair_Display } from 'next/font/google'
import './globals.css'
import { IconSprite } from '@/components/IconSprite'
import { UIProvider } from '@/components/ui-state'

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

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dascout.ph'

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${playfair.variable}`}>
      <body>
        <IconSprite />
        <a className="skip" href="#main">
          Skip to main content
        </a>
        <UIProvider>{children}</UIProvider>
      </body>
    </html>
  )
}
