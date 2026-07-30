import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/app/layout'

/**
 * `/admin` is disallowed because a staff sign-in form in search results is an invitation
 * to credential stuffing, and the pages behind it hold unpublished listings. This is the
 * politest of three layers: the admin segment also emits noindex robots metadata and an
 * `X-Robots-Tag` header, which apply to crawlers that never read robots.txt.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/admin' },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
