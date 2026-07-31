'use server'

import { redirect } from 'next/navigation'
import * as z from 'zod'
import { createClient } from '@/lib/supabase/server'

/**
 * "Stop alerting me about this request."
 *
 * Two rules shape this, and both are about the person on the other end of an email:
 *
 * 1. It is a POST, never a GET. Mail scanners and link previewers fetch every URL in a
 *    message before a human sees it; an unsubscribe that worked on GET would be
 *    unsubscribing people who never clicked anything.
 * 2. Every outcome looks the same. A token that matches, a token that does not, a token
 *    that is not even a UUID — all three land on the same confirmed page. The token is a
 *    request id, and a page that said "no such request" would turn this URL into a way
 *    of testing ids one at a time.
 *
 * The database function is SECURITY DEFINER and returns nothing whether or not the id
 * exists, so there is no answer to leak even if this wanted to give one.
 */

const TokenSchema = z.uuid()

export async function unsubscribeRequest(formData: FormData): Promise<void> {
  const parsed = TokenSchema.safeParse(formData.get('token'))

  if (parsed.success) {
    const supabase = await createClient()
    const { error } = await supabase.rpc('unsubscribe_property_request', {
      req_id: parsed.data,
    })
    // Logged, not shown. The visitor gets the same sentence either way.
    if (error) console.warn('[requests] unsubscribe failed, code:', error.code ?? 'unknown')
  }

  // The token leaves the address bar here, so a confirmed page cannot be shared,
  // bookmarked or leaked in a referrer with a live request id in it.
  redirect('/requests/unsubscribe?done=1')
}
