'use client'

import { useEffect, useRef, useState } from 'react'
import { syncAccountState } from '@/app/account/actions'
import {
  readAccountEpoch,
  readSyncMark,
  replaceFavorites,
  snapshotFavorites,
  writeSyncMark,
} from '@/components/ui-state'

/**
 * The one thing that merges this browser's saved properties with the account's.
 *
 * It is mounted once, in the root layout, so it covers every way a person can end up
 * signed in: the dialog on any page, a fresh page load with a session cookie already
 * present, a confirmation link, a reset link. There was going to be a second, faster
 * path inside the sign-in action itself; it was cut. Two triggers for one merge is two
 * places for the merge to be subtly different.
 *
 * It deliberately does not call `useUI()`. It writes through the module-level helpers in
 * `ui-state`, which notify the store's subscribers themselves, so this component can sit
 * outside the provider and cannot re-render the whole tree while it works.
 *
 * There are exactly two cases, and the marker tells them apart:
 *
 * - **The marker names a different account, or there is no marker.** First time on this
 *   device for this account. Upload what is local and NOT already accounted to somebody
 *   else's mirror, take back the union, and write the marker.
 * - **The marker names this account.** Refresh only: ask for the account's set, send
 *   nothing. This is what lets a favourite removed on a phone stay removed on the laptop
 *   — an upload here would resurrect it from a stale mirror on every page load, and the
 *   person would never be able to remove anything.
 */
export function AccountSync({ userId }: { userId: string | null }) {
  /**
   * Two mounts in quick succession (a cookie write re-renders the layout) would otherwise
   * fire two merges. The upsert is idempotent so a double run is harmless, but a second
   * round trip for nothing is still a second round trip.
   */
  const running = useRef(false)
  const done = useRef<string | null>(null)

  useEffect(() => {
    if (!userId) return
    if (running.current || done.current === userId) return

    running.current = true

    void (async () => {
      try {
        const epoch = readAccountEpoch()
        const local = snapshotFavorites()
        const mark = readSyncMark()
        const isSameAccount = mark?.userId === userId

        // Slugs already recorded as somebody else's mirror are not this browser's to
        // upload. Dropping them here is what stops one person's favourites walking onto
        // the next person's account on a shared machine.
        const mine = isSameAccount ? [] : local.filter((slug) => !(mark?.mirrored ?? []).includes(slug))

        const result = await syncAccountState({ favoriteSlugs: mine.slice(0, 200) })
        if (!result.ok) return

        // Somebody signed out while this was in flight. Writing now would restore the
        // account's favourites and the marker into a browser that has just been cleared
        // — on a shared machine, straight into the next person's hands.
        if (readAccountEpoch() !== epoch) return

        const account = result.data?.favoriteSlugs ?? []
        const mirrored = new Set(account)

        // Everything local the account does not hold is retained: slugs whose listing is
        // no longer public and therefore cannot be stored, plus anything past the
        // per-request cap that did not get sent. Nothing is dropped by a merge, ever.
        const localOnly = local.filter((slug) => !mirrored.has(slug))

        replaceFavorites([...account, ...localOnly])
        writeSyncMark({ userId, mirrored: account })
        done.current = userId
      } catch {
        // A failed merge leaves the browser exactly as it was. The next page load tries
        // again; there is nothing here worth interrupting somebody's browsing over.
      } finally {
        running.current = false
      }
    })()
  }, [userId])

  return null
}

/**
 * "3 of your saved properties are not currently listed."
 *
 * Only the browser can count this. A favourite whose listing has gone back to draft or
 * been withdrawn is hidden from the buyer's own session by row-level security, so the
 * server cannot see it at all — the local set minus the account's mirror is the only
 * place the number exists. Saying nothing would look like the site had quietly lost
 * somebody's saved property, which is the exact impression worth spending a line to
 * avoid.
 */
export function UnresolvedFavoritesNote({ userId }: { userId: string }) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const recount = () => {
      const mark = readSyncMark()
      if (!mark || mark.userId !== userId) {
        setCount(0)
        return
      }
      const mirrored = new Set(mark.mirrored)
      setCount(snapshotFavorites().filter((slug) => !mirrored.has(slug)).length)
    }

    recount()
    // The merge finishes after this mounts, so re-read when storage changes under us.
    window.addEventListener('storage', recount)
    const timer = setTimeout(recount, 1500)
    return () => {
      window.removeEventListener('storage', recount)
      clearTimeout(timer)
    }
  }, [userId])

  if (count < 1) return null

  return (
    <p className="amuted" style={{ marginBottom: 14 }}>
      {count} of your saved properties {count === 1 ? 'is' : 'are'} not currently listed. They stay
      saved in this browser and come back to your account if the listing returns.
    </p>
  )
}
