import type { Metadata } from 'next'
import Link from 'next/link'
import { Footer, Header, Sidebar } from '@/components/Chrome'
import { unsubscribeRequest } from './actions'

/**
 * Where the "stop alerts" link in an alert email lands.
 *
 * Plain on purpose. It renders the same for a good token, a bad token and no token at
 * all, and it changes nothing until the button is pressed — the mail scanner that
 * fetches every link in a message must not be able to unsubscribe anybody.
 */
export const metadata: Metadata = {
  title: 'Stop alerts',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
}

const CONFIRMED = 'You will not receive further alerts for this request.'

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token
  const done = (Array.isArray(params.done) ? params.done[0] : params.done) === '1'

  return (
    <>
      <Header />
      <Sidebar features={[]} />

      <main id="main" className="wrap" style={{ paddingBottom: 64 }}>
        <section className="apanel" style={{ maxWidth: 520, margin: '40px auto' }}>
          {done ? (
            <>
              <h1>Alerts stopped</h1>
              <p className="sub2">{CONFIRMED}</p>
              <p className="sub2">
                You can send a new request any time from the{' '}
                <Link href="/">DaScout home page</Link>.
              </p>
            </>
          ) : (
            <>
              <h1>Stop alerts for this request?</h1>
              <p className="sub2">
                We will stop emailing you when new verified listings match the request you saved.
                Nothing else about your details changes.
              </p>
              <form action={unsubscribeRequest}>
                {/* Whatever arrived in the link, unchanged. The action decides whether
                    it is a request id, and answers the same way either way. */}
                <input type="hidden" name="token" value={rawToken ?? ''} />
                <button className="btn btn-dark" type="submit">
                  Stop these alerts
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
