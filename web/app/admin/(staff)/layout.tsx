import Link from 'next/link'
import { isSuperAdminRole, requireStaff } from '@/lib/admin/auth'
import { signOut } from '@/app/admin/actions'

/**
 * The guarded half of /admin. `requireStaff()` here is the user-experience layer: it
 * sends a signed-out visitor to the sign-in page instead of rendering an empty shell,
 * and it does so before any child page starts fetching.
 *
 * It is not the security boundary. Every query function and every action re-checks
 * independently, because a layout only decides what a browser is shown — it does not
 * stand between a hand-written POST and the database.
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff()

  return (
    <>
      <div className="admin-bar">
        <div className="in">
          <b>DaScout Admin</b>
          <nav aria-label="Admin sections">
            <Link href="/admin">Listings</Link>
            <Link href="/admin/listings/new">New listing</Link>
            <Link href="/admin/requests">Requests</Link>
            {/* Shown to the owner tier only. This is signposting, not a control: the
                page itself calls requireSuperAdmin() and both RPCs behind it refuse a
                staff caller at the database. Hiding the link only saves a staff admin
                from clicking into a redirect.

                Asked through the predicate rather than `role === 'admin'` so there is one
                definition of "super admin" in the app; a second literal here is how the
                two drift apart the day the tier gains a third role. */}
            {isSuperAdminRole(user.role) && <Link href="/admin/admins">Admins</Link>}
            {/* Password management is one screen for every role, on the public side. */}
            <Link href="/account/password">Password</Link>
            <Link href="/">View site</Link>
          </nav>
          <span className="who">
            {user.fullName ?? user.email ?? 'Staff'} · {user.role}
          </span>
          <form action={signOut}>
            <button className="btn btn-ghost abtn-sm" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <main id="main" className="wrap admin-main">
        {children}
      </main>
    </>
  )
}
