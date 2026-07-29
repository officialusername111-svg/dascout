import type { NextConfig } from 'next'

/**
 * The Supabase host serves every listing photo and answers the view-recording
 * insert, so it is the one external origin the browser is allowed to talk to.
 * Read from the environment rather than hardcoded, so changing project cannot
 * silently leave the policy pointing at the wrong host.
 */
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : ''

/**
 * `frame-ancestors 'self'` is the one that matters most here: without it any site
 * can load DaScout in an invisible frame and overlay its own buttons, which is how
 * "claim your property" scams are built.
 *
 * `script-src` keeps 'unsafe-inline'. Next.js ships hydration data as inline script
 * tags, and the nonce-per-request alternative means routing every response through
 * the proxy — a real change, not a config line. What it would buy back is small
 * here: nothing on this site renders user-supplied HTML (no dangerouslySetInnerHTML
 * anywhere, and reflected search terms come back escaped), so there is no injection
 * point for the policy to block. Revisit when accounts and the admin land in
 * Phase 3/4 and user-authored content reaches the page.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  // 'unsafe-eval' is development-only: React's dev build uses eval() to rebuild
  // callstacks for its error overlay. It never does so in production, so the
  // deployed policy stays strict.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `img-src 'self' data: blob: ${supabaseOrigin}`.trim(),
  `connect-src 'self' ${supabaseOrigin}`.trim(),
  // The property page embeds a Google map of the town.
  'frame-src https://www.google.com',
  "frame-ancestors 'self'",
  'upgrade-insecure-requests',
].join('; ')

const nextConfig: NextConfig = {
  // Advertising the framework only helps someone shopping for a matching CVE.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
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
    ]
  },
}

export default nextConfig
