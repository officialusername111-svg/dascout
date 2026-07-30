'use server'

import { createHash, randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

const VIEW_SESSION_COOKIE = 'ds-vs'
const ONE_YEAR = 60 * 60 * 24 * 365

/** Postgres duplicate-key. Here it means "already counted today", which is the point. */
const UNIQUE_VIOLATION = '23505'

/**
 * Records that someone looked at a listing, which is what "Top Properties" ranks on.
 *
 * The browser used to insert this row itself, so anyone could sit in a loop and invent
 * a ranking. The session id is now issued by the server and kept in an HttpOnly cookie,
 * so page scripts cannot read or forge it, and the database holds one row per listing
 * per session per day — a refresh, or a script replaying the same session, changes
 * nothing.
 *
 * What this does not stop is someone discarding cookies between requests. Closing that
 * needs per-address rate limiting at the edge, which is a separate piece of work.
 *
 * The cookie is a random opaque id with nothing personal in it, and only its SHA-256
 * hash is stored, so the stored value cannot be traced back to a visitor's browser.
 */
export async function recordListingView(listingId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(listingId)) return

  const jar = await cookies()
  let sessionId = jar.get(VIEW_SESSION_COOKIE)?.value

  if (!sessionId || sessionId.length < 16) {
    sessionId = randomUUID()
    jar.set(VIEW_SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: ONE_YEAR,
    })
  }

  const sessionHash = createHash('sha256').update(sessionId).digest('hex')

  const supabase = await createClient()

  /**
   * Attribution happens here, at INSERT, and nowhere else. The row's insert policy
   * already permits `profile_id = auth.uid()`, so a signed-in visitor's views land
   * against their account and an anonymous visitor's land against nobody.
   *
   * There is no back-fill and no claim of earlier rows, because there is nothing left to
   * claim: the view-session id is rotated at every authentication boundary (see
   * `rotateViewSession` in `app/account/actions.ts`), so a visitor who browses
   * anonymously and then signs in gets a fresh session hash and their later views cannot
   * collide with the anonymous ones from the same day. The anonymous prefix of the day
   * stays unattributed by design; the browser's own history is what shows it.
   */
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase
    .from('listing_views')
    .insert({ listing_id: listingId, session_hash: sessionHash, profile_id: user?.id ?? null })

  if (error && error.code !== UNIQUE_VIOLATION) {
    // A missed view count is never worth failing a page over.
    console.warn('view not recorded:', error.message)
  }
}
