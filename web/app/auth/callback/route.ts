import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/lib/database.types'

/**
 * Where every link in an authentication email lands: email confirmations and password
 * recoveries both come back here, and this is the only place in the app that turns one
 * of those one-time credentials into a session.
 *
 * A route handler rather than a page, because this has to WRITE cookies and a server
 * component cannot. Six things make it safe, and each one is a real failure someone has
 * shipped before:
 *
 * 1. **Buffered cookies, one writer.** The Supabase client's cookie writes are collected
 *    into a buffer and replayed onto the response only when the exchange succeeded. A
 *    failed exchange therefore sets no session cookie at all, rather than leaving a
 *    half-written one behind. `proxy.ts` returns early for `/auth/*` so it is not a
 *    second writer racing this one on the same request.
 * 2. **`next` is a path on this site or nothing.** An open redirect on the one URL that
 *    arrives carrying a credential is worth more to an attacker than any other page on
 *    the site.
 * 3. **`token_hash` is accepted for `type=recovery` only.** A token in a URL is a bearer
 *    credential — it sits in mail-scanner logs and proxy logs. Recovery needs it, because
 *    people read mail on their phone and reset on their laptop and the PKCE flow cannot
 *    cross browsers. Nothing else gets that latitude.
 * 4. **A missing PKCE verifier is named, not swallowed.** A `?code=` link opened in a
 *    different browser than the one that requested it can never be exchanged. Left to
 *    the generic failure it reads as "the link is broken" forever; the honest sentence
 *    tells the person their email may well already be confirmed and to just sign in.
 * 5. **303, always.** The browser follows it with GET and the credential leaves the
 *    address bar.
 * 6. **`Cache-Control: no-store`, and the URL is never logged.** The URL contains the
 *    credential. It does not belong in a shared cache or in a log line.
 */

/** Every response from this route. The URL that reached it carries a credential. */
const NO_STORE = { 'Cache-Control': 'no-store' }

/** Where a link with no usable `next` should land. */
const DEFAULT_NEXT = '/account'

/** Where a recovery link always lands, whatever it asked for. */
const RECOVERY_NEXT = '/account/password?reset=1'

/**
 * A path on this site, or the default.
 *
 * One decode only: decoding twice is how `%252F%252Fevil.example` becomes a protocol
 * relative URL after the second pass. Then it must start with a single slash, contain
 * only characters that are legal in a path or a query, and not be under `/auth/` — that
 * last one is a loop guard, since bouncing this route at itself would be a redirect ring
 * rather than an error anybody could read.
 */
function safeNext(raw: string | null): string {
  if (!raw) return DEFAULT_NEXT

  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return DEFAULT_NEXT
  }

  // A backslash is a path separator to some browsers and not to some parsers, which is
  // exactly the disagreement an open redirect lives in. CR/LF would be header injection.
  if (decoded.includes('\\') || /[\r\n]/.test(decoded)) return DEFAULT_NEXT
  if (!/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(decoded)) return DEFAULT_NEXT
  if (decoded === '/auth' || decoded.startsWith('/auth/')) return DEFAULT_NEXT

  return decoded
}

/**
 * True when this browser holds the PKCE verifier that a `?code=` was issued against.
 *
 * Supabase names it `sb-<project-ref>-auth-token-code-verifier`, so match on the shape
 * rather than on a hardcoded project reference.
 */
function hasCodeVerifier(request: NextRequest): boolean {
  return request.cookies.getAll().some(
    (cookie) => cookie.name.startsWith('sb-') && cookie.name.endsWith('-code-verifier')
  )
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const code = params.get('code')
  const tokenHash = params.get('token_hash')
  const type = params.get('type')
  const requestedNext = safeNext(params.get('next'))

  /**
   * A recovery arrival goes to the password screen whatever `next` said, because that is
   * the only screen that can do anything with a recovery session. `?reset=1` on the end
   * is display sugar: the form choice itself is made server-side from the session's own
   * `amr` claim, and the query string authorises nothing.
   */
  const isRecovery = type === 'recovery' || requestedNext.startsWith('/account/password')

  /** Back to the public site with a reason the auth dialog knows how to explain. */
  const bail = (reason: 'wrong-browser' | 'expired' | 'link-invalid') => {
    const tab = isRecovery ? 'forgot' : 'login'
    const target = new URL(`/?auth=${tab}&reason=${reason}`, request.nextUrl.origin)
    // No buffered cookie is replayed on this path, so a failed exchange leaves the
    // browser exactly as anonymous as it arrived.
    return NextResponse.redirect(target, { status: 303, headers: NO_STORE })
  }

  // Collected, not written. Nothing reaches the browser unless the exchange worked.
  const buffered: { name: string; value: string; options?: Record<string, unknown> }[] = []

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          buffered.push(...cookiesToSet)
        },
      },
    }
  )

  let failed: { code?: string | null; status?: number } | null = null

  if (code) {
    if (!hasCodeVerifier(request)) return bail('wrong-browser')
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    failed = error ?? null
  } else if (tokenHash && type === 'recovery') {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
    failed = error ?? null
  } else if (tokenHash) {
    // Any other `type` on a bearer token: refused outright rather than exchanged.
    console.warn('[auth-callback] refused token_hash type:', type ?? 'none')
    return bail('expired')
  } else {
    return bail('link-invalid')
  }

  if (failed) {
    // The code, never the URL — the URL is the credential.
    console.warn('[auth-callback] exchange failed:', failed.code ?? failed.status ?? '?')
    return bail('expired')
  }

  const destination = isRecovery ? RECOVERY_NEXT : requestedNext
  const response = NextResponse.redirect(new URL(destination, request.nextUrl.origin), {
    status: 303,
    headers: NO_STORE,
  })

  for (const cookie of buffered) {
    response.cookies.set(cookie.name, cookie.value, cookie.options)
  }

  return response
}
