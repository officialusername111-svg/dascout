'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { recordVisit } from '@/components/ui-state'

/**
 * Two records per visit: one in the browser so "Continue browsing" works, and one
 * view event in Postgres so "Top Properties" ranks on something real. Counted once
 * per browser session per listing, so a refresh does not inflate the ranking.
 */
export function RecordVisit({ listingId, slug }: { listingId: string; slug: string }) {
  useEffect(() => {
    recordVisit(slug)

    const key = `ds-viewed-${listingId}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      // Storage denied — still count the view, just possibly more than once.
    }

    createClient()
      .from('listing_views')
      .insert({ listing_id: listingId })
      .then(({ error }) => {
        if (error) console.warn('view not recorded', error.message)
      })
  }, [listingId, slug])

  return null
}
