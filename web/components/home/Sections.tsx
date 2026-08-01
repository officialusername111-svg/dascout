import Link from 'next/link'
import { Icon } from '@/components/Icon'
import { CreateAccountButton } from '@/components/home/Panels'

/* v6: four statements, no links. The three "→" links were removed deliberately — these
   read as claims about the service, not as navigation. "Real Support" was dropped by the
   owner, which is what lets the remaining four sit in a clean 2x2. */
const ABOUT_ROWS = [
  {
    icon: 'check',
    title: 'Verified Listings Only',
    body: 'Every property we feature is checked before it reaches you.',
  },
  {
    icon: 'target',
    title: 'Curated Matches',
    body: "Based on what you're actually looking for, not everything on the market.",
  },
  {
    icon: 'key',
    title: 'Direct Owner Access',
    body:
      'Every listing comes straight from the property owner, not resellers, so details stay accurate.',
  },
  {
    icon: 'star',
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
            Here&rsquo;s what you can expect <em>from us</em>
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
 */
export function VerifiedBand() {
  return (
    <section aria-labelledby="verifyH">
      <div className="verify">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="shot"
          src="/assets/verified-fields.jpg"
          alt="Aerial view of a highway cutting through rice fields and coconut groves in Mindanao"
        />
        <div className="vtext">
          <h2 id="verifyH">
            We Don&rsquo;t Just List Properties. <em>We Verify Them.</em>
          </h2>
          <p>
            DaScout exists because real estate shouldn&rsquo;t run on trust alone — it should run on
            proof. We&rsquo;re Mindanao&rsquo;s exclusive, verified real estate platform, built for
            buyers who can&rsquo;t be everywhere at once: OFWs, investors, and professionals
            purchasing property from thousands of miles away. Every listing is title-checked,
            boundary-walked, and confirmed on the ground before it ever reaches you, because owning
            property should feel like a decision, not a leap of faith.
          </p>
          <CreateAccountButton className="btn btn-gold">
            Get started today <Icon name="arrow" />
          </CreateAccountButton>
        </div>
      </div>
    </section>
  )
}
