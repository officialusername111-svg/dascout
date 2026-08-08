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
 * v2 enhancement round, arrangement A (owner's pick 2026-08-07): the split billboard.
 * Two pictures only — a pre-composited backdrop (panel + silk already flattened by the
 * client) and the transparent gold pin. Kicker, wordmark and statement are all LIVE TEXT.
 *
 * That is the whole point of this rebuild. The band it replaces was one flat 5063px
 * artwork, so the paragraph rendered at roughly 4px on a phone and existed only as a
 * 462-character `alt` string. Nothing here is pixels-of-words any more, so no alt string
 * carries the copy and the text reflows, scales and can be selected.
 *
 * THE PIN CANNOT DEFORM. It is an <img> carrying its own intrinsic 313x450, not a box
 * with a hand-kept aspect-ratio. Only `height` is set in CSS; `width:auto` lets the
 * intrinsic ratio decide the rest, `object-fit:contain` letterboxes rather than stretches
 * if some ancestor ever forces a width, and `flex:none` stops the row squashing it.
 * Three independent guards, none of which needs anyone to remember 0.6956.
 *
 * The <section> carries NO aria-label. It used to, and it had to, because the band's words
 * were pixels and the label was the only way to reach them. Now that the kicker and the
 * wordmark are real text, a label repeating them makes a screen reader announce the same
 * phrase twice — once as the region name, then again as content. Removing it is part of the
 * same change that made the words real, not an oversight.
 */
export function VerifiedBand() {
  return (
    <section>
      <div className="verify">
        <div className="pwbs-band">
          <div className="pwbs-grid">
            <div>
              <div className="pwbs-lock">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="pwbs-pin"
                  src="/assets/pin-320.webp"
                  srcSet="/assets/pin-160.webp 160w, /assets/pin-320.webp 320w"
                  sizes="(max-width:560px) 80px, 150px"
                  width={313}
                  height={450}
                  alt=""
                  aria-hidden="true"
                />
                <div>
                  <div className="pwbs-kicker">Partnering You with the Best</div>
                  <div className="pwbs-wordmark">
                    <span className="pwbs-wm-gold">Buyers&amp;</span>
                    <span className="pwbs-wm-white">Sellers</span>
                  </div>
                </div>
              </div>
              <div className="pwbs-cta">
                <CreateAccountButton className="btn btn-gold">
                  Get started today <Icon name="arrow" />
                </CreateAccountButton>
              </div>
            </div>
            <div className="pwbs-glass">
              <p className="pwbs-copy">
                <span className="brand">DaScout</span> exists because real estate
                shouldn&rsquo;t run on trust alone &mdash; it should run on proof.
                We&rsquo;re Mindanao&rsquo;s exclusive, verified real estate platform, built
                for buyers who can&rsquo;t be everywhere at once:{' '}
                <strong>OFWs, investors,</strong> and <strong>professionals</strong>{' '}
                purchasing property from thousands of miles away. Every listing is
                title-checked, boundary-walked, and confirmed on the ground before it ever
                reaches you, because owning property should feel like a decision, not a leap
                of faith.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
