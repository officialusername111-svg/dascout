import type { NextConfig } from 'next'

/**
 * The Content-Security-Policy is NOT here. It moved to `proxy.ts`, because it now carries a
 * per-request nonce in script-src and headers declared in this file are fixed at build time —
 * one policy string baked into every response, which is the one thing a nonce cannot be.
 * `proxy.ts` is the single source of truth for the CSP; everything below is the rest of the
 * security headers, which have no per-request part and stay here. Do not re-add a CSP entry
 * to this file: two Content-Security-Policy headers on one response are not merged by the
 * browser, they are both enforced, and the strictest wins — a stale copy here would silently
 * block the nonced scripts the proxy just authorised.
 */

/**
 * Preview deployments serve a full copy of the site on a public *.vercel.app address.
 * Left indexable they compete with the real domain for the same listings and go stale.
 * Only the production deployment should be in a search index.
 */
const isProductionDeploy = process.env.VERCEL_ENV
  ? process.env.VERCEL_ENV === 'production'
  : true

const nextConfig: NextConfig = {
  // Advertising the framework only helps someone shopping for a matching CVE.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          ...(isProductionDeploy
            ? []
            : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]),
          // Belt and braces with frame-ancestors, for older browsers.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
        ],
      },
      {
        // The admin's own noindex metadata only reaches a crawler that renders the page.
        // A header reaches the ones that do not, including anything that only follows a
        // link far enough to read the response headers.
        source: '/admin/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        // Somebody's saved properties and browsing history. `no-store` matters as much as
        // the noindex here: a shared machine, or any proxy between it and us, must not be
        // able to serve one visitor's account page to the next person who asks for it.
        source: '/account/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        // These URLs carry one-time credentials in their query string. Nothing about them
        // belongs in a cache or in a search index, and the route handler sets the same
        // header itself — this covers the responses it never gets to write.
        source: '/auth/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ]
  },
}

export default nextConfig
