'use server'

import { redirect } from 'next/navigation'
import * as z from 'zod'
import { createClient } from '@/lib/supabase/server'

/**
 * "Yes, this request is mine — start alerting me."
 *
 * The mirror of `requests/unsubscribe/actions.ts`, and shaped by the same two rules:
 *
 * 1. It is a POST, never a GET. Mail scanners and link previewers fetch every URL in a
 *    message before a human sees it; a confirm that worked on GET would be opting in
 *    people who never clicked anything.
 * 2. Every outcome looks the same. A token that matches, a token that does not, a token
 *    that is not even a UUID, a token already confirmed — all land on the same done page.
 *    A page that said "no such request" would turn this URL into a way of testing ids
 *    one at a time.
 *
 * The database function is SECURITY DEFINER, idempotent, expires with the 180-day alert
 * window, and returns nothing whether or not the id existed, so there is no answer to
 * leak even if this wanted to give one.
 */

const TokenSchema = z.uuid()

export async function confirmRequest(formData: FormData): Promise<void> {
  const parsed = TokenSchema.safeParse(formData.get('token'))

  if (parsed.success) {
    const supabase = await createClient()
    const { error } = await supabase.rpc('confirm_property_request', {
      req_id: parsed.data,
    })
    // Logged, not shown. The visitor gets the same sentence either way.
    if (error) console.warn('[requests] confirm failed, code:', error.code ?? 'unknown')
  }

  // The token leaves the address bar here, so a confirmed page cannot be shared,
  // bookmarked or leaked in a referrer with a live request id in it.
  redirect('/requests/confirm?done=1')
}
