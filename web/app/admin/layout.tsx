import type { Metadata } from 'next'

/**
 * Metadata only — deliberately no guard here.
 *
 * `/admin/sign-in` is a child of this segment and has to stay reachable while signed
 * out, so the access check lives one level down in the `(staff)` route group. Putting
 * it here would lock people out of the door they are meant to knock on.
 *
 * The noindex directive belongs at this level so it covers the sign-in page too, and
 * no child page sets its own `robots` key — one place to read, one place to change.
 * It is backed up by an `X-Robots-Tag` header in next.config.ts and a `robots.txt`
 * disallow, because a crawler that never renders the page still sees the header.
 */
export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin' },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children
}
