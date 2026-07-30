import type { Metadata } from 'next'
import { SignInForm } from '@/components/admin/SignInForm'

/**
 * The one admin route that stays public — everything else sits inside the `(staff)`
 * group behind `requireStaff()`. No `robots` key here: the parent admin layout already
 * marks the whole segment noindex.
 */
export const metadata: Metadata = { title: 'Staff sign-in' }

type Search = Record<string, string | string[] | undefined>

export default async function SignInPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams
  const denied = (Array.isArray(params.denied) ? params.denied[0] : params.denied) === '1'

  return (
    <main id="main" className="asignin">
      <h1>DaScout Admin</h1>
      <p className="lede">
        For DaScout staff. Listings, verification records and publishing live behind this
        sign-in.
      </p>
      <div className="apanel">
        <SignInForm denied={denied} />
      </div>
      <p className="amuted">
        No staff account? Ask whoever administers the DaScout Supabase project — accounts are not
        self-service.
      </p>
    </main>
  )
}
