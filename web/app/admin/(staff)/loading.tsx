import { LoadingMark } from '@/components/LoadingMark'

/**
 * The Suspense fallback for the staff-guarded admin pages (listings, requests, settings,
 * admins). Only replaces `{children}` inside StaffLayout's `<main>` — the dark admin bar
 * above it is part of the layout, not this segment, so it stays visible and interactive
 * while a page's own data (e.g. getAdminListingDetail's ~2s round trip) is still loading.
 *
 * Uses the same `public` mark as the buyer-facing loading state so there's one loading
 * experience across the site rather than two.
 */
export default function Loading() {
  return <LoadingMark variant="public" />
}
