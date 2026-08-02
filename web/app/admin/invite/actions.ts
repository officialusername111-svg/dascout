'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { INVITE_COOKIE, inviteCookieOptions, normaliseInviteToken } from '@/lib/admin/invites'

/**
 * "Yes, this invitation is mine."
 *
 * This module exists SEPARATELY from `app/admin/actions.ts` for one structural reason:
 * every action in that file opens with a staff guard, and an invitee is by definition
 * not staff yet. Mixing an ungated action into a file whose first two lines are always a
 * guard is how a future copy-paste ships a staff action with no guard. Same reasoning,
 * same words, as the note at the top of `app/account/actions.ts`.
 *
 * Ungated here does not mean ungated. `redeem_admin_invite` is granted to
 * `authenticated` only — never `anon` — and it makes its own decision from three facts
 * the caller controls only one of: the token hashes to a live, unexpired, unused row;
 * that row's address equals the caller's OWN address read from `auth.users` inside the
 * function; and that address is confirmed. Six different failures come back as the one
 * word 'invalid', so this endpoint cannot be used to find out which tokens exist.
 *
 * The token is never logged, never returned, and never put back in a URL.
 */

/**
 * No parameters, exactly like `signOut` in `app/admin/actions.ts`: the form carries no
 * fields. Everything this needs is the cookie the route handler left behind and the
 * caller's own session — nothing the browser posts is read, so there is nothing for a
 * hand-written POST to supply.
 */
export async function acceptAdminInvite(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(INVITE_COOKIE)?.value ?? null

  /**
   * Deleted FIRST, unconditionally, before anything that could throw.
   *
   * Single use starts here rather than at the database. If the RPC call raises, or the
   * process dies mid-request, the cookie must not survive to be replayed — and the
   * deletion must not be sitting in a branch that a failure skips.
   *
   * Written as a `set` with `maxAge: 0` rather than `delete(name)` because the cookie is
   * path-scoped to `/admin/invite`: a delete that defaults to path `/` clears a different
   * cookie than the one that was set, and the real one lives on.
   */
  jar.set(INVITE_COOKIE, '', { ...inviteCookieOptions(), maxAge: 0 })

  let accepted = false
  const presented = normaliseInviteToken(token)

  if (presented) {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('redeem_admin_invite', { raw_token: presented })

    if (error) {
      // The code, never the token, and never the address. This line is all anybody gets
      // when a report arrives saying "the invite link didn't work".
      console.warn('[admin-invite] redemption failed, code:', error.code ?? 'unknown')
    } else {
      accepted = data === 'accepted'
    }
  }

  if (accepted) {
    /**
     * The role the admin shell renders is read per request, but the rendered result is
     * cached per path. Without this the freshly promoted admin's first look at /admin is
     * the shell they had a second ago — which is to say, a sign-in page.
     */
    revalidatePath('/admin', 'layout')
    redirect('/admin/invite/accept?done=1')
  }

  redirect('/admin/invite/accept?failed=1')
}
