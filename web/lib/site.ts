/**
 * The site's own address, used for canonical links, the sitemap, share previews and
 * every auth email's redirect target.
 *
 * A trailing slash is stripped so `${SITE_URL}/property/x` never doubles up, and the
 * fallback is this project's real domain — pointing search engines (or a password-reset
 * link) at a domain we do not own is worse than any missing tag.
 *
 * This lives in `lib/` rather than in `app/layout.tsx` for two reasons. It is read by
 * `robots.ts` and `sitemap.ts`, which have no business importing a layout; and it is
 * read by the account actions when they build the `redirectTo` for a confirmation or
 * recovery email. That last one is the security-relevant part: the redirect target is
 * always this compile-time constant and never a value taken off the request, because a
 * `Host`/`X-Forwarded-Host` header an attacker controls would send the recovery link
 * (and with it the one-time code) to a host of their choosing.
 *
 * No `next/headers` import, so client components may read it safely.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dascoutprime.com').replace(
  /\/+$/,
  ''
)
