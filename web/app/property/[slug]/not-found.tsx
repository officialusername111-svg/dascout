import Link from 'next/link'
import { Footer, Header, Sidebar } from '@/components/Chrome'
import { Icon } from '@/components/Icon'

export default function ListingNotFound() {
  return (
    <>
      <Header />
      <Sidebar features={[]} />
      <main id="main" className="wrap">
        <div className="notfound">
          <h1>Listing not found</h1>
          <p>This property may have been sold or removed.</p>
          <Link className="btn btn-dark" href="/#listings">
            Browse available listings <Icon name="arrow" />
          </Link>
        </div>
      </main>
      <Footer />
    </>
  )
}
