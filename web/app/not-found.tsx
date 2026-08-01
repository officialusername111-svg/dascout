import Link from 'next/link'
import { Footer, Header, Sidebar } from '@/components/Chrome'
import { Icon } from '@/components/Icon'

export default function NotFound() {
  return (
    <>
      <Header />
      <Sidebar features={[]} />
      <main id="main" className="wrap">
        <div className="notfound">
          <h1>Page not found</h1>
          <p>The page you were looking for is not here.</p>
          <Link className="btn btn-dark" href="/#listings">
            Browse available listings <Icon name="arrow" />
          </Link>
        </div>
      </main>
      <Footer />
    </>
  )
}
