'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react'
import { setFavorite } from '@/app/account/actions'

/**
 * The bits of the mockup that lived in globals on `window`: the mobile drawer, the two
 * dialogs, the toast, saved favourites and browsing history.
 *
 * Favourites and history still live in `localStorage` for everyone. For a signed-in
 * visitor the browser is now a MIRROR of the account rather than the only copy, and the
 * third key here is what makes that mirror honest:
 *
 *   ds-favs  the slugs this browser has saved            (unchanged)
 *   ds-hist  what this browser has looked at             (unchanged)
 *   ds-sync  { userId, mirrored } — which of those slugs came off which account
 *
 * `mirrored` is the provenance record, and every hard question about a shared browser is
 * answered by it. On sign-out, `ds-favs` becomes `ds-favs ∖ mirrored`: the next person on
 * the machine inherits nothing that came off somebody's account, while a favourite this
 * browser saved itself — including one whose listing has since been withdrawn and can
 * therefore never be stored on any account — survives. `userId` is part of the marker so
 * a second person signing in on the same machine is recognised as a different account
 * and does not inherit the first one's set.
 */

const FAV_KEY = 'ds-favs'
const HIST_KEY = 'ds-hist'
const SYNC_KEY = 'ds-sync'

export type HistoryEntry = { slug: string; at: number }

/** What of the local favourites is a copy of which account's rows. */
export type SyncMark = { userId: string; mirrored: string[] }

function readList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

/* ---- localStorage as an external store, so the server render stays empty ---- */

const EMPTY_FAVORITES: string[] = []
const EMPTY_HISTORY: HistoryEntry[] = []

let favorites = EMPTY_FAVORITES
let history = EMPTY_HISTORY
let hydrated = false

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function hydrate() {
  favorites = readList<string>(FAV_KEY)
  history = readList<HistoryEntry>(HIST_KEY)
  hydrated = true
}

function subscribe(listener: () => void) {
  // First subscriber reads storage; React re-reads the snapshot right after, so the
  // saved state appears on the render straight after hydration.
  if (!hydrated) hydrate()

  const onStorage = (event: StorageEvent) => {
    if (event.key !== FAV_KEY && event.key !== HIST_KEY) return
    hydrate()
    emit()
  }

  listeners.add(listener)
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private browsing with storage denied — state still holds for this visit.
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    // Same as above: the in-memory state below is cleared either way.
  }
}

function setFavorites(next: string[]) {
  favorites = next
  write(FAV_KEY, next)
  emit()
}

/** Called by the property page so "Continue browsing" has something to show. */
export function recordVisit(slug: string) {
  if (!hydrated) hydrate()
  history = [{ slug, at: Date.now() }, ...history.filter((entry) => entry.slug !== slug)].slice(0, 12)
  write(HIST_KEY, history)
  emit()
}

/* ---- what AccountSync and the account screens read and write ---- */

/** The local favourites as they stand, for code outside the React tree. */
export function snapshotFavorites(): string[] {
  if (!hydrated) hydrate()
  return favorites
}

/** The local history as it stands, for the account's history list. */
export function snapshotHistory(): HistoryEntry[] {
  if (!hydrated) hydrate()
  return history
}

/** Replaces the whole local set — used only by the merge, with its union result. */
export function replaceFavorites(next: string[]) {
  if (!hydrated) hydrate()
  setFavorites([...new Set(next)])
}

export function readSyncMark(): SyncMark | null {
  try {
    const raw = localStorage.getItem(SYNC_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const { userId, mirrored } = parsed as { userId?: unknown; mirrored?: unknown }
    if (typeof userId !== 'string' || !userId) return null
    const slugs = Array.isArray(mirrored)
      ? mirrored.filter((slug): slug is string => typeof slug === 'string')
      : []
    return { userId, mirrored: slugs }
  } catch {
    return null
  }
}

export function writeSyncMark(mark: SyncMark) {
  write(SYNC_KEY, { userId: mark.userId, mirrored: [...new Set(mark.mirrored)] })
}

/**
 * Keeps the marker in step with a single heart tap, so the provenance record does not go
 * stale between merges. A tap made while the marker belongs to somebody else is ignored
 * rather than recorded against them.
 */
export function noteMirrored(userId: string, slug: string, present: boolean) {
  const mark = readSyncMark()
  if (!mark || mark.userId !== userId) return
  const slugs = new Set(mark.mirrored)
  if (present) slugs.add(slug)
  else slugs.delete(slug)
  writeSyncMark({ userId, mirrored: [...slugs] })
}

/**
 * Bumped by every sign-out.
 *
 * A merge that was already in flight when somebody signed out must not write its result
 * afterwards — it would put the account's favourites and the marker straight back into a
 * browser that has just been cleared, which on a shared machine hands them to the next
 * person. Callers capture this before they await and check it before they write.
 */
let accountEpoch = 0

export function readAccountEpoch(): number {
  return accountEpoch
}

/**
 * What sign-out does to this browser, applied BEFORE the session is destroyed.
 *
 * Account-derived favourites go, this browser's own stay, history goes, the marker goes.
 * Running it after the redirect would be too late — the page would already have been
 * replaced.
 */
export function applyAccountSignOut() {
  if (!hydrated) hydrate()
  accountEpoch += 1

  const mark = readSyncMark()
  const mirrored = new Set(mark?.mirrored ?? [])
  setFavorites(favorites.filter((slug) => !mirrored.has(slug)))

  remove(HIST_KEY)
  history = EMPTY_HISTORY

  remove(SYNC_KEY)
  emit()
}

/** Local half of "clear browsing history". The server half is `clearAccountHistory`. */
export function clearLocalHistory() {
  remove(HIST_KEY)
  history = EMPTY_HISTORY
  emit()
}

/** Applied idempotently from live module state, so a revert cannot double up. */
function applyFavorite(slug: string, saved: boolean) {
  if (!hydrated) hydrate()
  const present = favorites.includes(slug)
  if (saved && !present) setFavorites([...favorites, slug])
  if (!saved && present) setFavorites(favorites.filter((value) => value !== slug))
}

/* ---- the provider ---- */

type AuthTab = 'login' | 'register' | 'forgot'

const AUTH_TABS: AuthTab[] = ['login', 'register', 'forgot']

type UIState = {
  sidebarOpen: boolean
  openSidebar: () => void
  closeSidebar: () => void
  authTab: AuthTab | null
  openAuth: (tab: AuthTab) => void
  closeAuth: () => void
  /** Why the auth dialog opened by itself, when it did — set by the callback bounce. */
  authReason: string | null
  toast: (message: string) => void
  favorites: string[]
  isFavorite: (slug: string) => boolean
  toggleFavorite: (slug: string, title: string) => void
  history: HistoryEntry[]
  clearHistory: () => void
  /** Null when nobody is signed in. Comes from the server on every render. */
  accountUserId: string | null
  accountName: string | null
}

const Context = createContext<UIState | null>(null)

export function useUI(): UIState {
  const value = useContext(Context)
  if (!value) throw new Error('useUI must be used inside <UIProvider>')
  return value
}

export function UIProvider({
  children,
  accountUserId = null,
  accountName = null,
}: {
  children: React.ReactNode
  accountUserId?: string | null
  accountName?: string | null
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [authTab, setAuthTab] = useState<AuthTab | null>(null)
  const [authReason, setAuthReason] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, startTransition] = useTransition()

  const saved = useSyncExternalStore(subscribe, () => favorites, () => EMPTY_FAVORITES)
  const visited = useSyncExternalStore(subscribe, () => history, () => EMPTY_HISTORY)

  const toast = useCallback((text: string) => {
    setMessage(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(''), 4000)
  }, [])

  /**
   * `/auth/callback` bounces a failed link back to `/?auth=login&reason=…`, and this is
   * what turns that into an open dialog carrying the explanation. Read from
   * `window.location` on mount rather than with `useSearchParams`, because this provider
   * wraps every page in the site and making all of them read search params to serve one
   * bounce is a poor trade. The two parameters are then stripped from the address bar so
   * a refresh does not reopen the dialog.
   */
  useEffect(() => {
    const url = new URL(window.location.href)
    const requested = url.searchParams.get('auth')
    if (!requested) return

    const tab = AUTH_TABS.find((value) => value === requested)
    const reason = url.searchParams.get('reason')

    url.searchParams.delete('auth')
    url.searchParams.delete('reason')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)

    if (!tab) return

    // Opened one tick later, not during this effect. The server rendered no dialog, so
    // setting the state synchronously here would both cascade a second render and make
    // the hydrated markup disagree with what the server sent.
    const open = setTimeout(() => {
      setAuthTab(tab)
      setAuthReason(reason)
    }, 0)
    return () => clearTimeout(open)
  }, [])

  /**
   * A heart tap. The browser updates first and asks the server second, because a
   * favourite is not worth a spinner — but a write that failed has to be taken back,
   * rather than leaving the browser claiming something the account does not hold.
   *
   * Signed out, this is exactly the behaviour the site has always had.
   */
  const toggleFavorite = useCallback(
    (slug: string, title: string) => {
      const wasSaved = snapshotFavorites().includes(slug)
      const nowSaved = !wasSaved

      applyFavorite(slug, nowSaved)
      toast(nowSaved ? `Saved "${title}" to favorites` : `Removed "${title}" from favorites`)

      if (!accountUserId) return

      const epoch = accountEpoch
      startTransition(async () => {
        const result = await setFavorite({ slug, saved: nowSaved })
        // A sign-out landed while this was in flight. Neither branch may write now: the
        // revert would put an account-derived slug back into a browser that has just
        // been cleared for the next person.
        if (accountEpoch !== epoch) return
        if (result.ok) {
          noteMirrored(accountUserId, slug, nowSaved)
          return
        }
        applyFavorite(slug, wasSaved)
        toast('Could not save that to your account. Try again.')
      })
    },
    [toast, accountUserId, startTransition]
  )

  const clearHistory = useCallback(() => {
    clearLocalHistory()
    toast('Browsing history cleared')
  }, [toast])

  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo<UIState>(
    () => ({
      sidebarOpen,
      openSidebar: () => setSidebarOpen(true),
      closeSidebar,
      authTab,
      openAuth: (tab) => {
        setAuthReason(null)
        setAuthTab(tab)
      },
      closeAuth: () => {
        setAuthReason(null)
        setAuthTab(null)
      },
      authReason,
      toast,
      favorites: saved,
      isFavorite: (slug) => saved.includes(slug),
      toggleFavorite,
      history: visited,
      clearHistory,
      accountUserId,
      accountName,
    }),
    [
      sidebarOpen,
      closeSidebar,
      authTab,
      authReason,
      toast,
      saved,
      toggleFavorite,
      visited,
      clearHistory,
      accountUserId,
      accountName,
    ]
  )

  return (
    <Context.Provider value={value}>
      {children}
      <div className={`toast${message ? ' on' : ''}`} role="status" aria-live="polite">
        {message}
      </div>
    </Context.Provider>
  )
}
