import { NextResponse, type NextRequest } from 'next/server'

/**
 * Where an invitation email lands. It renders nothing, reads nothing and changes nothing.
 *
 * WHAT THIS USED TO DO, AND WHY IT NO LONGER DOES (run-p9, 2026-08-02). Until the
 * self-service door was retired, this handler existed to take a raw invitation token out
 * of the URL — Vercel's access log records full query strings and `Referer` hands them
 * onward — and stash it in a short-lived, path-scoped, httpOnly cookie (`ds-ai`) for the
 * accept page to spend. There is no longer any such thing as spending a token:
 * `redeem_admin_invite` is not callable by anybody (§5 of
 * `20260802204500_admin_invite_approval_queue.sql`) and new invitations do not carry one.
 * So the cookie is gone, the token parsing is gone, and what is left is a redirect.
 *
 * IT IS KEPT, RATHER THAN DELETED, FOR ONE CONCRETE REASON: invitations already sent
 * point here, some of them with `?token=…` still on the URL, and they have to land
 * somewhere that explains the flow rather than on a 404. That is the whole job.
 *
 * THE QUERY STRING IS NEVER PARSED. Not to read a token, not to log one, not to pass one
 * on — `request.nextUrl.searchParams` is not touched, and the destination is built fresh
 * with no search params at all, so an old token-bearing URL dies here. The two headers do
 * real work in that: `Referrer-Policy: no-referrer` stops the URL that carried the token
 * from being announced to anything the landing page loads, and `no-store` keeps it out of
 * any shared cache. Both are cheap, and both still matter for links already in mailboxes.
 *
 * GET only, and it mutates nothing — the same rule as before. A mail scanner that fetches
 * every URL in a message gets a redirect and nothing else.
 */

const SAFE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
}

export async function GET(request: NextRequest) {
  const destination = new URL('/admin/invite/welcome', request.nextUrl.origin)

  return NextResponse.redirect(destination, { status: 303, headers: SAFE_HEADERS })
}
