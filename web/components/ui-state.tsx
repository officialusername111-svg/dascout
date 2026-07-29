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
} from 'react'

/**
 * The bits of the mockup that lived in globals on `window`: the mobile drawer, the two
 * dialogs, the toast, and saved favourites. Favourites and browsing history stay in
 * `localStorage` until Phase 3 moves them onto the account.
 */

const FAV_KEY = 'ds-favs'
const HIST_KEY = 'ds-hist'

export type HistoryEntry = { slug: string; at: number }

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

/* ---- the provider ---- */

type AuthTab = 'login' | 'register' | 'forgot'

type UIState = {
  sidebarOpen: boolean
  openSidebar: () => void
  closeSidebar: () => void
  authTab: AuthTab | null
  openAuth: (tab: AuthTab) => void
  closeAuth: () => void
  requestOpen: boolean
  openRequest: () => void
  closeRequest: () => void
  toast: (message: string) => void
  favorites: string[]
  isFavorite: (slug: string) => boolean
  toggleFavorite: (slug: string, title: string) => void
  history: HistoryEntry[]
  clearHistory: () => void
}

const Context = createContext<UIState | null>(null)

export function useUI(): UIState {
  const value = useContext(Context)
  if (!value) throw new Error('useUI must be used inside <UIProvider>')
  return value
}

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [authTab, setAuthTab] = useState<AuthTab | null>(null)
  const [requestOpen, setRequestOpen] = useState(false)
  const [message, setMessage] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saved = useSyncExternalStore(subscribe, () => favorites, () => EMPTY_FAVORITES)
  const visited = useSyncExternalStore(subscribe, () => history, () => EMPTY_HISTORY)

  const toast = useCallback((text: string) => {
    setMessage(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(''), 4000)
  }, [])

  const toggleFavorite = useCallback(
    (slug: string, title: string) => {
      const isSaved = favorites.includes(slug)
      setFavorites(isSaved ? favorites.filter((s) => s !== slug) : [...favorites, slug])
      toast(isSaved ? `Removed "${title}" from favorites` : `Saved "${title}" to favorites`)
    },
    [toast]
  )

  const clearHistory = useCallback(() => {
    try {
      localStorage.removeItem(HIST_KEY)
    } catch {
      // ignore — the panel empties either way
    }
    history = EMPTY_HISTORY
    emit()
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
      openAuth: (tab) => setAuthTab(tab),
      closeAuth: () => setAuthTab(null),
      requestOpen,
      openRequest: () => setRequestOpen(true),
      closeRequest: () => setRequestOpen(false),
      toast,
      favorites: saved,
      isFavorite: (slug) => saved.includes(slug),
      toggleFavorite,
      history: visited,
      clearHistory,
    }),
    [sidebarOpen, closeSidebar, authTab, requestOpen, toast, saved, toggleFavorite, visited, clearHistory]
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
