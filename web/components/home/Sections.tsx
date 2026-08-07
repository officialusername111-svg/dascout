import Link from 'next/link'
import { Icon } from '@/components/Icon'
import { CreateAccountButton } from '@/components/home/Panels'

/* v6: four statements, no links. The three "→" links were removed deliberately — these
   read as claims about the service, not as navigation. "Real Support" was dropped by the
   owner, which is what lets the remaining four sit in a clean 2x2.
   v2 enhancement round (A4/A5): the icons are the SOLID glyphs the client's artwork draws,
   and the fourth is a gem rather than a star. */
const ABOUT_ROWS = [
  {
    icon: 'check-fill',
    title: 'Verified Listings Only',
    body: 'Every property we feature is checked before it reaches you.',
  },
  {
    icon: 'target-fill',
    title: 'Curated Matches',
    body: "Based on what you're actually looking for, not everything on the market.",
  },
  {
    icon: 'key-fill',
    title: 'Direct Owner Access',
    body:
      'Every listing comes straight from the property owner, not resellers, so details stay accurate.',
  },
  {
    icon: 'gem-fill',
    title: 'Exclusive Opportunities',
    body: "These properties aren't seen anywhere else on the market.",
  },
] as const

export function AboutRows() {
  return (
    <section aria-labelledby="aboutH">
      <div className="expect">
        <div className="lead">
          <h2 id="aboutH">
            Here&rsquo;s what you can expect <em>from us.</em>
          </h2>
          <p>
            Mindanao&rsquo;s exclusive, verified real estate platform, built for buyers who
            can&rsquo;t be everywhere at once.
          </p>
          <Link className="btn btn-gold" href="/#listings">
            See Verified Listings <Icon name="arrow" />
          </Link>
        </div>
        <div className="ecards">
          {ABOUT_ROWS.map((row) => (
            <div className="ecard" key={row.title}>
              <span className="ic">
                <Icon name={row.icon} />
              </span>
              <b>{row.title}</b>
              <span>{row.body}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/**
 * Why the platform exists, with the account CTA. Placed after the expectations band and
 * before Top Properties, so the invitation to sign up lands while someone is still
 * deciding rather than after they have started browsing rankings.
 *
 * v2 enhancement round (A6/A7/A8): this band is now the client's supplied artwork as a
 * FLAT image (owner's decision D1), which retired the aerial photo and the "We Don't Just
 * List Properties" heading. The statement now exists only as pixels inside the picture,
 * so `alt` carries the whole paragraph verbatim — that string is the accessible copy of
 * the band, not a description of it, and must stay in step with the artwork.
 * The 6.5 MB source is never served: `<picture>` picks a 32–80 KB webp, with a 134 KB
 * jpg for browsers without webp.
 */
export function VerifiedBand() {
  return (
    <section aria-label="Partnering you with the best buyers and sellers">
      <div className="verify">
        <picture>
          <source
            type="image/webp"
            srcSet="/assets/buyers-sellers-900.webp 900w, /assets/buyers-sellers-1400.webp 1400w, /assets/buyers-sellers-2000.webp 2000w"
            sizes="(max-width:1268px) 100vw, 1220px"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="banner"
            src="/assets/buyers-sellers-2000.jpg"
            width={2000}
            height={753}
            alt="Partnering you with the best buyers and sellers. DaScout exists because real estate shouldn’t run on trust alone, it should run on proof. We’re Mindanao’s exclusive, verified real estate platform, built for buyers who can’t be everywhere at once: OFWs, investors, and professionals purchasing property from thousands of miles away. Every listing is title-checked, boundary-walked, and confirmed on the ground before it ever reaches you, because owning property should feel like a decision, not a leap of faith."
          />
        </picture>
        <CreateAccountButton className="btn btn-gold">
          Get started today <Icon name="arrow" />
        </CreateAccountButton>
      </div>
    </section>
  )
}
