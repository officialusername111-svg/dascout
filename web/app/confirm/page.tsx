import type { Metadata } from 'next'
import { ConfirmEmailForm } from '@/components/account/ConfirmEmailForm'

/**
 * Where somebody enters the 6-digit code that confirms their email address.
 *
 * A TOP-LEVEL PUBLIC ROUTE, and each half of that is deliberate:
 *
 * - Public, because the person standing here is by definition NOT confirmed and usually
 *   not signed in. It cannot live under `app/account/`, whose layout calls
 *   `requireAccountUser()` and would bounce every visitor this page exists for back to
 *   the home page. Same reasoning as `app/admin/invite/welcome/`, which sits outside the
 *   staff route group for the same kind of reason.
 * - Top level rather than under `/admin/`, because the code step is not an admin thing.
 *   It replaced the confirmation LINK for every signup on this site; an invited admin is
 *   simply the person who cares most about what happens after it.
 *
 * It renders identically for every visitor and changes nothing on GET. Exactly ONE thing
 * is read from the URL — `?invited=1` — and it picks the wording of the follow-up panel
 * and authorises nothing whatsoever. A mail scanner that fetches this URL confirms
 * nobody, because confirming is a POST from a form the visitor fills in.
 *
 * THERE IS NO `?email=` PREFILL, and that is the same rule the invitation link follows
 * (see `lib/admin/invites.ts`): a query string is written into Vercel's access log for
 * every request and handed onward by `Referer`, so an address there would be somebody's
 * personal data logged in two places we do not control — to save one keystroke. An
 * earlier version of this page accepted the parameter. Nothing in the product ever
 * generated such a URL, so no address was ever logged, but a latent surface the
 * codebase's own rule forbids is not something to leave lying about. The visitor types
 * the address they signed up with, which they have in front of them in the email.
 *
 * `noindex` because there is nothing here for a search engine — it is one step of a flow.
 */
export const metadata: Metadata = {
  title: 'Confirm your email',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
}

type Search = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string {
  const single = Array.isArray(value) ? value[0] : value
  return typeof single === 'string' ? single : ''
}

export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const params = await searchParams

  /** A string off a URL, trusted for nothing: it chooses words and grants nothing. */
  const invited = first(params.invited) === '1'

  return (
    <main id="main" className="asignin">
      <h1>DaScout</h1>
      <ConfirmEmailForm invited={invited} />
    </main>
  )
}
