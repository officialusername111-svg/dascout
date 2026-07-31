import type { Metadata } from 'next'
import Link from 'next/link'
import { Footer, Header, Sidebar, UtilityBar } from '@/components/Chrome'
import { confirmRequest } from './actions'

/**
 * Where the confirm link in a "Confirm your DaScout property request" email lands.
 *
 * A deliberate duplicate of `requests/unsubscribe/page.tsx`, not an abstraction over it —
 * two ~70-line pages with different copy and different RPCs (panel ruling: duplicate, do
 * not abstract). Plain on purpose: it renders the same for a good token, a bad token and
 * no token at all, and it changes nothing until the button is pressed — the mail scanner
 * that fetches every link in a message must not be able to confirm anybody.
 */
export const metadata: Metadata = {
  title: 'Confirm request',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
}

const CONFIRMED = "We'll email you when a matching verified listing goes live."

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token
  const done = (Array.isArray(params.done) ? params.done[0] : params.done) === '1'

  return (
    <>
      <UtilityBar />
      <Header />
      <Sidebar features={[]} />

      <main id="main" className="wrap" style={{ paddingBottom: 64 }}>
        <section className="apanel" style={{ maxWidth: 520, margin: '40px auto' }}>
          {done ? (
            <>
              <h1>Request confirmed</h1>
              <p className="sub2">{CONFIRMED}</p>
              <p className="sub2">
                Every alert carries a link to stop them. Browse listings on the{' '}
                <Link href="/">DaScout home page</Link>.
              </p>
            </>
          ) : (
            <>
              <h1>Confirm alerts for this request?</h1>
              <p className="sub2">
                Press the button and we will email you when a new verified listing matches
                the request you saved. Until then, nothing is sent.
              </p>
              <form action={confirmRequest}>
                {/* Whatever arrived in the link, unchanged. The action decides whether
                    it is a request id, and answers the same way either way. */}
                <input type="hidden" name="token" value={rawToken ?? ''} />
                <button className="btn btn-navy" type="submit">
                  Confirm this request
                </button>
              </form>
            </>
          )}
        </section>
      </main>

      <Footer />
    </>
  )
}
