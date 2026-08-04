import { LoadingMark } from '@/components/LoadingMark'

/**
 * The Suspense fallback for every public route under this segment (home, property
 * pages, requests, account) that doesn't define a more specific `loading.tsx` of its
 * own. See LoadingMark for why this exists — it replaces the freeze-then-blink
 * navigation, it doesn't decorate it.
 */
export default function Loading() {
  return <LoadingMark variant="public" />
}
