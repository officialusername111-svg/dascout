import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * The Supabase host serves every listing photo and answers the view-recording
 * insert, so it is the one external origin the browser is allowed to talk to.
 * Read from the environment rather than hardcoded, so changing project cannot
 * silently leave the policy pointing at the wrong host.
 */
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : ''

const isDev = process.env.NODE_ENV === 'development'

/**
 * The Content-Security-Policy is built here, once per request, because it now carries a
 * per-request nonce — a value that cannot exist in `next.config.ts`, where headers are
 * fixed at build time. This file is the single source of truth for the CSP; every other
 * security header still comes from `next.config.ts`.
 *
 * `script-src 'self' 'nonce-…' 'strict-dynamic'` is the point of the exercise. Scripts are
 * the injection vector that matters: a script that reaches the page runs with full access to
 * the visitor's session cookies and can post to Supabase as them. The old policy said
 * 'unsafe-inline', which tells the browser "run any inline script tag you find" — that is
 * exactly the capability an injected `<script>` needs, so the directive was closing nothing.
 * With a nonce, only the script tags Next.js itself stamps with this request's random value
 * execute; an injected tag has no way to guess the value. `'strict-dynamic'` then lets those
 * trusted bootstrap scripts load the chunk files they need without us maintaining a URL
 * allowlist, and (per the CSP spec) makes browsers that understand it ignore 'self' and any
 * host expression in this directive, so the trust flows only from the nonce.
 *
 * `style-src` deliberately KEEPS 'unsafe-inline'. Inline `style={{…}}` attributes are used
 * throughout the components, and a nonce cannot cover a style *attribute* — only a `<style>`
 * element — so nonce-ing styles would mean rewriting every component's inline style first.
 * The risk it leaves behind is far smaller than the script one: injected CSS can restyle or
 * obscure the page, but it cannot read cookies, call Supabase, or execute code. Scripts are
 * the vector being closed here; styles are a separate, later cleanup.
 *
 * Every other directive carries over unchanged from the previous `next.config.ts` policy.
 * `frame-ancestors 'self'` is the one that matters most after script-src: without it any site
 * can load DaScout in an invisible frame and overlay its own buttons, which is how
 * "claim your property" scams are built.
 */
function buildCsp(nonce: string) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    // 'unsafe-eval' is development-only: React's dev build uses eval() to rebuild
    // callstacks for its error overlay. It never does so in production, so the
    // deployed policy stays strict.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: ${supabaseOrigin}`.trim(),
    `connect-src 'self' ${supabaseOrigin}`.trim(),
    // The property page embeds a Google map of the town.
    'frame-src https://www.google.com',
    "frame-ancestors 'self'",
    'upgrade-insecure-requests',
  ].join('; ')
}

/**
 * Two jobs on every matched request:
 *
 * 1. Mint a nonce and attach the CSP. This has to happen for ALL matched paths, including
 *    the `/auth/` ones that skip the session refresh below — a page served without the
 *    header is a page served without the policy.
 * 2. Refresh the Supabase session and hand the updated cookies back to the browser. Without
 *    this, server components eventually read an expired token and treat a signed-in buyer
 *    as anonymous.
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = buildCsp(nonce)

  /**
   * Next.js does not read `x-nonce`; during server-side rendering it parses the
   * Content-Security-Policy header *on the request*, pulls the `'nonce-…'` value out of
   * script-src, and stamps it onto the framework and page script tags itself. So both
   * headers go on the request: the CSP one is what actually wires the nonce into the HTML,
   * and `x-nonce` is there for any server component that ever needs to hand the nonce to a
   * `<Script>` of its own.
   *
   * `.set()` on the cloned headers is doing real work: it OVERWRITES anything the client
   * sent. A visitor is free to put their own `x-nonce` or `Content-Security-Policy` header
   * on a request; if we merged rather than replaced, an attacker could supply a nonce they
   * already know and have Next.js stamp it onto the page. The inbound values are never
   * trusted.
   *
   * Rebuilt as a function rather than a shared object because Supabase's `setAll` mutates
   * `request.cookies` (and therefore the request's `cookie` header) partway through the
   * refresh; a Headers clone taken before that would carry the stale cookies upstream.
   */
  const requestHeadersWithCsp = () => {
    const headers = new Headers(request.headers)
    headers.set('x-nonce', nonce)
    headers.set('Content-Security-Policy', csp)
    return headers
  }

  /**
   * `/auth/callback` is the one request where a second cookie writer is a bug rather
   * than a refresh: the route handler exchanges a one-time code for a session and writes
   * the session cookies itself, and a refresh attempt running here on the same request
   * would race it — two writers, one `Set-Cookie` header, whichever lands last wins.
   * Returning early leaves exactly one writer on that request.
   *
   * Only the *refresh* is skipped. The nonce and the CSP are applied the same as anywhere
   * else, because the auth routes render HTML too (an error page when a code has expired)
   * and are the last place that should be running unvetted scripts.
   */
  if (request.nextUrl.pathname.startsWith('/auth/')) {
    const authResponse = NextResponse.next({
      request: { headers: requestHeadersWithCsp() },
    })
    authResponse.headers.set('Content-Security-Policy', csp)
    return authResponse
  }

  let response = NextResponse.next({ request: { headers: requestHeadersWithCsp() } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request: { headers: requestHeadersWithCsp() } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Touching the user is what triggers the refresh — do not remove.
  await supabase.auth.getUser()

  // Set last: `setAll` above replaces the response object outright when the session is
  // refreshed, which would discard a header set any earlier.
  response.headers.set('Content-Security-Policy', csp)

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files.
     *
     * The Next.js CSP guide also suggests skipping `next/link` prefetches (the
     * `next-router-prefetch` / `purpose: prefetch` missing-header conditions). Not applied
     * here, deliberately: this proxy is not only a header writer, it is the session refresh.
     * Prefetches on this site fetch RSC payloads for real pages — /account, /admin, a
     * property page rendered for a signed-in buyer — and those payloads are rendered on the
     * server with whatever token the request carried and then held in the client router
     * cache. Skipping the refresh for them means a prefetch made a minute after the token
     * expired renders as anonymous, and the visitor then navigates into a cached signed-out
     * view of their own account. The cost of keeping them matched is one extra header on a
     * payload that never parses it; the cost of excluding them is a signed-in user shown
     * signed-out content. Keeping the matcher as-is.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
