import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/database.types'

/**
 * Who is allowed into /admin, resolved once per request.
 *
 * Two rules make this trustworthy rather than decorative:
 *
 * 1. Identity comes from `auth.getUser()`, which re-verifies the token with
 *    Supabase. `getSession()` only decodes whatever cookie the browser sent, so
 *    a forged or expired cookie would read as a valid session — never use it to
 *    decide access.
 * 2. The role comes from an own-row `profiles` select, not from the JWT. Roles
 *    live in a table a staff-guard trigger protects; a claim baked into a token
 *    at sign-in time would keep working after a demotion.
 *
 * There is no `import 'server-only'` here because the package is not installed.
 * The module reaches `next/headers` through `lib/supabase/server`, and Turbopack
 * already hard-fails any client bundle that pulls that in — which is the same
 * guarantee. Client components must never import this file.
 */

type UserRole = Database['public']['Enums']['user_role']

export type StaffRole = 'staff' | 'admin'

export type StaffUser = {
  id: string
  email: string | null
  /** Snapshot of the display name, so panels can name the actor without a second read. */
  fullName: string | null
  role: StaffRole
}

/**
 * Three outcomes, not two: the sign-in page needs to tell "you are not signed
 * in" apart from "you are signed in and still not allowed", because the second
 * one has to say so instead of silently looping through the login form.
 */
export type AdminIdentity =
  | { state: 'anonymous' }
  | { state: 'denied' }
  | { state: 'staff'; user: StaffUser }

/** `is_staff()` in the database is true for both of these; the app agrees with it. */
export function isStaffRole(role: UserRole): role is StaffRole {
  return role === 'staff' || role === 'admin'
}

/**
 * `cache()` memoises this for the length of one request only, so a page and the
 * three panels it renders share one round trip while a later request still
 * re-verifies from scratch (a sign-out between requests takes effect at once).
 */
export const checkStaff = cache(async (): Promise<AdminIdentity> => {
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

  // A missing profile row is a denial, not an error: the row is what carries the
  // role, and no row means no grant.
  if (!profile || !isStaffRole(profile.role)) return { state: 'denied' }

  return {
    state: 'staff',
    user: {
      id: profile.id,
      email: user.email ?? null,
      fullName: profile.full_name,
      role: profile.role,
    },
  }
})

/**
 * The staff user or nothing. Server actions use this: they must answer a denied
 * caller with a result the form can render, never a redirect thrown mid-mutation.
 */
export const getStaffUser = cache(async (): Promise<StaffUser | null> => {
  const identity = await checkStaff()
  return identity.state === 'staff' ? identity.user : null
})

/**
 * The staff user, or a redirect away from the page. Read paths use this — a query
 * that cannot name its caller must not return rows, which is why every exported
 * query function opens with it rather than trusting the layout above it.
 */
export async function requireStaff(): Promise<StaffUser> {
  const identity = await checkStaff()
  if (identity.state === 'anonymous') redirect('/admin/sign-in')
  if (identity.state === 'denied') redirect('/admin/sign-in?denied=1')
  return identity.user
}
