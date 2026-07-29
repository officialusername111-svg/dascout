'use client'

import { useEffect } from 'react'
import { recordListingView } from '@/app/actions'
import { recordVisit } from '@/components/ui-state'

/**
 * Two records per visit: one in the browser so "Continue browsing" works, and one view
 * event in Postgres so "Top Properties" ranks on something real.
 *
 * The database write goes through a server action rather than the browser's Supabase
 * client: the session id behind it is server-issued and HttpOnly, so a page script
 * cannot forge one and invent a ranking. Repeat visits in the same session are
 * discarded by the database, so no client-side guard is needed.
 */
export function RecordVisit({ listingId, slug }: { listingId: string; slug: string }) {
  useEffect(() => {
    recordVisit(slug)
    void recordListingView(listingId)
  }, [listingId, slug])

  return null
}
