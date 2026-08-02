import { NextResponse, type NextRequest } from 'next/server'
import { INVITE_COOKIE, inviteCookieOptions, normaliseInviteToken } from '@/lib/admin/invites'

/**
 * Where the link in an invitation email lands. It renders nothing and changes nothing.
 *
 * A route handler rather than a page, for the same reason `/auth/callback` is one: this
 * has to WRITE a cookie, and a server component cannot (see `lib/supabase/server.ts` —
 * the cookie writer there is wrapped in a try/catch precisely because rendering is
 * read-only). Four rules make it safe:
 *
 * 1. **GET only, and it mutates nothing.** Mail scanners and link previewers fetch every
 *    URL in a message before a human sees it. If arriving here promoted anybody, the
 *    scanner would be the one accepting the invitation. The mutation is a POST from the
 *    accept page, behind a button — the same shape `requests/confirm` uses.
 * 2. **The token leaves the URL here and never comes back.** Vercel's access log records
 *    full query strings, and `Referer` hands them to whatever the next page talks to. The
 *    token goes into a short-lived, path-scoped, httpOnly cookie and the browser is sent
 *    on to a URL with no query string at all.
 * 3. **Shape only.** 64 lowercase hex characters is all this checks. Whether the token is
 *    real, live, unused and addressed to this person is a question only
 *    `redeem_admin_invite` may answer, and it answers every failure the same way.
 * 4. **Every arrival looks identical.** A malformed token, an absent token and a perfect
 *    token all get the same 303 to the same URL. The difference is a cookie the visitor
 *    cannot read. There is nothing here to probe.
 *
 * `Referrer-Policy: no-referrer` on the redirect stops the URL that carried the token
 * from being announced to anything the destination page loads, and `no-store` keeps it
 * out of any shared cache.
 */

const SAFE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
}

export async function GET(request: NextRequest) {
  // Trimmed and lower-cased first, exactly as `redeem_admin_invite` does it — a strict
  // check here would refuse a link a mail client padded before the database ever got the
  // chance to rescue it. Neither step removes entropy: the alphabet is lower-case hex.
  const token = normaliseInviteToken(request.nextUrl.searchParams.get('token'))

  // No query string on the destination. Nothing to log, nothing to bookmark, nothing to
  // leak in a referrer, and nothing to share by accident.
  const destination = new URL('/admin/invite/accept', request.nextUrl.origin)

  const response = NextResponse.redirect(destination, { status: 303, headers: SAFE_HEADERS })

  // Set only for a well-formed token. A missing cookie makes the accept page ask the
  // visitor to open the link again — which is what an unusable link deserves, and says
  // nothing about whether any particular token exists.
  if (token) {
    response.cookies.set(INVITE_COOKIE, token, inviteCookieOptions())
  }

  return response
}
