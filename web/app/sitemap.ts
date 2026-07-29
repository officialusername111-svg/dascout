import type { MetadataRoute } from 'next'
import { createAnonClient } from '@/lib/supabase/anon'
import { SITE_URL } from '@/app/layout'

/** Home plus every live listing, so search engines can find the properties. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createAnonClient()
  const { data } = await supabase
    .from('listings')
    .select('slug, updated_at')
    .eq('status', 'live')
    .order('updated_at', { ascending: false })

  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    ...(data ?? []).map((listing) => ({
      url: `${SITE_URL}/property/${listing.slug}`,
      lastModified: new Date(listing.updated_at),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ]
}
