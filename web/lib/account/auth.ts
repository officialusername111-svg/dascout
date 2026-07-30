import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/database.types'

/**
 * Who is signed in on the public side, resolved once per request.
 *
 * This is the sibling of `lib/admin/auth.ts` with the staff test taken out — the same
 * two rules make it trustworthy rather than decorative:
 *
 * 1. Identity comes from `auth.getUser()`, which re-verifies the token with Supabase.
 *    `getSession()` only decodes whatever cookie the browser sent, so a forged or
 *    expired cookie would read as a valid session — never use it to decide access.
 * 2. The role comes from an own-row `profiles` select, not from the JWT. Roles live in
 *    a table a guard trigger protects; a claim baked into a token at sign-in time would
 *    keep working after a demotion.
 *
 * There is no `import 'server-only'` here because the package is not installed. The
 * module reaches `next/headers` through `lib/supabase/server`, and Turbopack already
 * hard-fails any client bundle that pulls that in — the same guarantee. Client
 * components must never import this file; they use `app/account/actions.ts` instead.
 */

type UserRole = Database['public']['Enums']['user_role']

export type AccountUser = {
  id: string
  email: string | null
  /** Snapshot of the display name, so a page can name the person without a second read. */
  fullName: string | null
  role: UserRole
}

export type AccountIdentity =
  | { state: 'anonymous' }
  | { state: 'signed-in'; user: AccountUser }

/**
 * `cache()` memoises this for the length of one request only, so the layout, the page
 * and the queries it calls share one round trip while the next request re-verifies from
 * scratch (a sign-out between requests takes effect at once).
 */
export const getAccountIdentity = cache(async (): Promise<AccountIdentity> => {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { state: 'anonymous' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', user.id)
    .maybeSingle()

  // A verified session with no profile row still belongs to a real person — the row is
  // created by a trigger on signup and only carries the display name and the role. Treat
  // a missing one as a plain buyer rather than as a denial, because unlike the admin
  // there is no elevated capability here for the row to be granting.
  return {
    state: 'signed-in',
    user: {
      id: user.id,
      email: user.email ?? null,
      fullName: profile?.full_name ?? null,
      role: profile?.role ?? 'buyer',
    },
  }
})

/**
 * The signed-in user or nothing. Server actions use this: they must answer a signed-out
 * caller with a result the form can render, never a redirect thrown mid-mutation.
 */
export const getAccountUser = cache(async (): Promise<AccountUser | null> => {
  const identity = await getAccountIdentity()
  return identity.state === 'signed-in' ? identity.user : null
})

/**
 * The signed-in user, or a redirect off the page. Pages and queries use this — a query
 * that cannot name its caller must not return rows, which is why every exported query
 * function opens with it rather than trusting the layout above it.
 *
 * Anonymous visitors go to the home page rather than to a sign-in page: on the public
 * side the sign-in form is a dialog on that page, so this is where the door is.
 */
export async function requireAccountUser(): Promise<AccountUser> {
  const identity = await getAccountIdentity()
  if (identity.state === 'anonymous') redirect('/')
  return identity.user
}

/** The authentication methods a password *reset* can legitimately have arrived through. */
const RECOVERY_METHODS = new Set(['otp', 'recovery', 'magiclink'])

/** Fifteen minutes. Long enough to type two passwords, short enough to be a window. */
const RECOVERY_WINDOW_SECONDS = 15 * 60

/**
 * Did this session arrive through a verified recovery link in the last fifteen minutes?
 *
 * This is the gate that lets `/account/password` skip the current-password field. It is
 * read from the session's own `amr` claim — Supabase records every authentication method
 * the session has been through, with a timestamp, inside the signed token.
 *
 * That is the whole point. The first design used a marker cookie set by the callback,
 * and the marker was mintable: an attacker with the victim's stolen session cookies
 * could run a recovery link on their OWN account, keep the marker, and pair it with the
 * victim's session to set a new password without knowing the old one. A claim inside the
 * token cannot be transplanted between sessions, because the token carries the identity
 * and the method together and Supabase signs both.
 *
 * `?reset=1` in the URL authorises nothing anywhere — it only chooses a heading.
 */
export async function hasRecentRecovery(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<boolean> {
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data) return false

  const amr = data.claims.amr
  if (!Array.isArray(amr)) return false

  const now = Math.floor(Date.now() / 1000)

  return amr.some((entry) => {
    // The claim is typed as `AMREntry[] | string[]`; only the detailed form carries the
    // timestamp this check needs, and a bare method name proves nothing about when.
    if (typeof entry !== 'object' || entry === null) return false
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown }
    if (typeof method !== 'string' || !RECOVERY_METHODS.has(method)) return false
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return false
    const age = now - timestamp
    // A small negative age is clock skew between us and the auth server, not a forgery;
    // anything further into the future is not a window we are willing to honour.
    return age <= RECOVERY_WINDOW_SECONDS && age >= -60
  })
}
