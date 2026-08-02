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
 * The owner tier. `is_super_admin()` in the database asks exactly this question of
 * exactly the same row, and this predicate exists so the app agrees with it.
 *
 * Deliberately a SECOND predicate rather than a narrowing of `isStaffRole`: every
 * listing, photo and verification guard in the app means "may work the listing panel"
 * when it says staff, and rule 1 is that a staff admin keeps all of that. Only the
 * screens that create and remove admin accounts ask this one.
 */
export function isSuperAdminRole(role: UserRole): role is 'admin' {
  return role === 'admin'
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

/**
 * The super admin or nothing. The sibling of `getStaffUser` for the two actions that
 * create and remove admin accounts: like every other action they must answer a caller
 * they refuse with a result the form can render, never a redirect thrown mid-mutation.
 *
 * It reuses `checkStaff()` — and therefore its `cache()` — so asking both questions in
 * one request is still one round trip, and there is still exactly one place that reads
 * the role from the profiles row.
 *
 * This is not the security boundary either. `create_admin_invite` and
 * `revoke_staff_admin` both re-check `is_super_admin()` inside the database, which is
 * what holds against a hand-written POST that never went past this function.
 */
export const getSuperAdmin = cache(async (): Promise<StaffUser | null> => {
  const identity = await checkStaff()
  if (identity.state !== 'staff') return null
  return isSuperAdminRole(identity.user.role) ? identity.user : null
})

/**
 * The super admin, or a redirect away from the page. Three destinations, not two,
 * because the three refusals are genuinely different situations:
 *
 * - anonymous → the staff sign-in door, same as `requireStaff`.
 * - denied (signed in, not staff) → the same door with the same explanation, so this
 *   screen never tells an outsider that an admin-management page exists.
 * - staff but not super admin → back to /admin. They are legitimately signed in and
 *   have real work to do there; bouncing them to a sign-in form would read as "your
 *   session broke" and invite a support call.
 */
export async function requireSuperAdmin(): Promise<StaffUser> {
  const identity = await checkStaff()
  if (identity.state === 'anonymous') redirect('/admin/sign-in')
  if (identity.state === 'denied') redirect('/admin/sign-in?denied=1')
  if (!isSuperAdminRole(identity.user.role)) redirect('/admin')
  return identity.user
}
