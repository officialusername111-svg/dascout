import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

/**
 * Three segments are disallowed, for three different reasons.
 *
 * `/admin` because a staff sign-in form in search results is an invitation to credential
 * stuffing, and the pages behind it hold unpublished listings. `/account` because it is
 * one person's saved properties and browsing history and has no business in an index at
 * all. `/auth` because those URLs carry one-time credentials, and a crawler following one
 * out of a mail preview would burn the link before its owner ever clicked it.
 *
 * This is the politest of three layers: all three segments also emit noindex robots
 * metadata or an `X-Robots-Tag` header, which apply to crawlers that never read
 * robots.txt.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/account', '/auth'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
