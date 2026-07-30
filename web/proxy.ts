import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Refreshes the Supabase session on every request and hands the updated cookies
 * back to the browser. Without this, server components eventually read an expired
 * token and treat a signed-in buyer as anonymous.
 */
export async function proxy(request: NextRequest) {
  /**
   * `/auth/callback` is the one request where a second cookie writer is a bug rather
   * than a refresh: the route handler exchanges a one-time code for a session and writes
   * the session cookies itself, and a refresh attempt running here on the same request
   * would race it — two writers, one `Set-Cookie` header, whichever lands last wins.
   * Returning early leaves exactly one writer on that request.
   */
  if (request.nextUrl.pathname.startsWith('/auth/')) return NextResponse.next({ request })

  let response = NextResponse.next({ request })

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
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Touching the user is what triggers the refresh — do not remove.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    // everything except static assets and image files
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
