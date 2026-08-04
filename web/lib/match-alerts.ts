import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { SITE_URL } from '@/lib/site'
import { peso } from '@/lib/format'
import type { Database } from '@/lib/database.types'

/**
 * "A listing you asked for just went live."
 *
 * SERVER ONLY, and called from exactly one place: `transitionListing`, inside `after()`,
 * when a listing has just moved to live. Nothing else may call it — the whole design
 * assumes the caller is a staff session that has already committed the publish.
 *
 * The properties that make it safe to hang off a statutory write:
 *
 * - It never throws. Every path is inside one try/catch that warns and returns. A
 *   publish that succeeded must stay succeeded whatever email does.
 * - It is idempotent per (request, listing). `request_match_alerts` has that pair as its
 *   primary key, and the insert ignores duplicates, so a withdraw → relist cycle — which
 *   fires this again for the same listing — cannot mail the same person twice.
 * - `sent_at` is written only after the provider accepted the message, so a failed send
 *   leaves the row unsent and the NEXT publish of that listing retries it. That is the
 *   only retry there is, and it is deliberate: no queue, no timer, nothing to lose in an
 *   app restart.
 * - Sends are capped per publish. A listing that matches four hundred saved requests
 *   sends twenty and logs the rest as deferred rather than melting the mail budget in
 *   one go; the rest go out on the next publish of that listing.
 * - The email contains NOTHING the requester wrote. Their own notes coming back at them
 *   through a mail client is a rendering surface with no upside.
 * - Logs carry counts. Never an address.
 */

type DbCategory = Database['public']['Enums']['listing_category']

/** Requests older than this are stale intent; nobody wants a mail about a six-month-old wish. */
const CANDIDATE_WINDOW_DAYS = 180

/** Most emails one request will ever cause, across every listing, for its whole life. */
const LIFETIME_ALERT_CAP = 10

/** Most emails one publish will send. The remainder waits for the next publish. */
const SEND_CAP_PER_PUBLISH = 20

/** Bound on how many open requests one publish will consider. */
const CANDIDATE_CEILING = 1000

/** `in (…)` chunk size, so the URL PostgREST builds stays sane. */
const IN_CHUNK = 100

type CandidateRequest = {
  id: string
  category: DbCategory | null
  preferred_town: string | null
  budget_min: number | null
  budget_max: number | null
}

type ListingForAlerts = {
  id: string
  slug: string
  title: string
  price_php: number
  /** Null when the listing's property type has no legacy_category mapping. */
  category: DbCategory | null
  status: string
  towns: { name: string; province: string } | null
}

/**
 * Whether a saved request wants this town.
 *
 * People type "Polomolok", "Polomolok, South Cotabato", "South Cotabato" or "gensan
 * area" into one free-text box, so this is deliberately generous in three directions
 * and case-blind in all of them. A blank preference matches everywhere — somebody who
 * did not name a town did not mean "nowhere".
 */
export function townMatches(
  preferred: string | null,
  town: { name: string; province: string } | null
): boolean {
  const wanted = (preferred ?? '').trim().toLowerCase()
  if (!wanted) return true
  if (!town) return false

  const name = town.name.trim().toLowerCase()
  const province = town.province.trim().toLowerCase()

  return wanted.includes(name) || wanted.includes(province) || name.includes(wanted)
}

/** Whether the asking price sits inside a stated budget. An open end is not a limit. */
export function priceMatches(
  price: number,
  budgetMin: number | null,
  budgetMax: number | null
): boolean {
  const floor = budgetMin ?? 0
  const ceiling = budgetMax ?? Number.POSITIVE_INFINITY
  return price >= floor && price <= ceiling
}

/**
 * Whether the request's property type admits this listing. No stated type means any type.
 * A listing whose own type has no legacy_category (a type added after listing encoding v2
 * apply 3, with no mapping to the old enum) never matches a request that named a specific
 * type — there is nothing to compare against — but still matches an "any type" request.
 */
export function categoryMatches(wanted: DbCategory | null, listing: DbCategory | null): boolean {
  return wanted === null || wanted === listing
}

function alertBody(listing: ListingForAlerts, requestId: string): string {
  const where = listing.towns ? `${listing.towns.name}, ${listing.towns.province}` : 'Mindanao'

  return [
    'A new verified listing on DaScout matches a property request you saved.',
    '',
    listing.title,
    where,
    peso(Number(listing.price_php)),
    `${SITE_URL}/property/${listing.slug}`,
    '',
    'You are getting this because you asked DaScout to tell you when a matching',
    'verified listing goes live.',
    '',
    `Stop alerts for that request: ${SITE_URL}/requests/unsubscribe?token=${requestId}`,
  ].join('\n')
}

/**
 * Mails everyone whose saved request matches a listing that has just gone live.
 *
 * Matching happens here in TypeScript rather than in the query on purpose: the town rule
 * is a three-way fuzzy comparison that no index would serve, the candidate set is small
 * (open requests from the last six months), and a filter written in PostgREST syntax is
 * a filter nobody can unit-test.
 */
export async function sendMatchAlerts(listingId: string): Promise<void> {
  try {
    const supabase = await createClient()

    const { data: listingRow, error: listingError } = await supabase
      .from('listings')
      .select(
        'id, slug, title, price_php, status, towns ( name, province ), property_types ( legacy_category )'
      )
      .eq('id', listingId)
      .maybeSingle()

    if (listingError) {
      console.warn('[alerts] listing read failed, code:', listingError.code ?? 'unknown')
      return
    }

    const rawListing = listingRow as unknown as
      | (Omit<ListingForAlerts, 'category'> & {
          property_types: { legacy_category: DbCategory | null } | null
        })
      | null
    if (!rawListing || rawListing.status !== 'live') return

    const listing: ListingForAlerts = {
      ...rawListing,
      category: rawListing.property_types?.legacy_category ?? null,
    }

    const since = new Date(Date.now() - CANDIDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const { data: requestRows, error: requestError } = await supabase
      .from('property_requests')
      .select('id, category, preferred_town, budget_min, budget_max')
      .eq('is_handled', false)
      // Double opt-in: a request nobody confirmed is a request nobody consented to.
      // Confirmed-later requests re-enter here on the next publish of a matching listing.
      .not('confirmed_at', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(CANDIDATE_CEILING)

    if (requestError) {
      console.warn('[alerts] request read failed, code:', requestError.code ?? 'unknown')
      return
    }

    const candidates = (requestRows ?? []) as CandidateRequest[]

    const matched = candidates.filter(
      (request) =>
        categoryMatches(request.category, listing.category) &&
        priceMatches(
          Number(listing.price_php),
          request.budget_min === null ? null : Number(request.budget_min),
          request.budget_max === null ? null : Number(request.budget_max)
        ) &&
        townMatches(request.preferred_town, listing.towns)
    )

    let inserted = 0

    if (matched.length) {
      // One pass over this request's alert history gives both answers: does a row for
      // THIS listing already exist, and has this request had its lifetime's worth.
      const matchedIds = matched.map((request) => request.id)
      const totals = new Map<string, number>()
      const alreadyForThisListing = new Set<string>()
      let historyFailed = false

      for (let index = 0; index < matchedIds.length; index += IN_CHUNK) {
        const chunk = matchedIds.slice(index, index + IN_CHUNK)
        const { data, error } = await supabase
          .from('request_match_alerts')
          .select('request_id, listing_id')
          .in('request_id', chunk)

        if (error) {
          console.warn('[alerts] alert history read failed, code:', error.code ?? 'unknown')
          historyFailed = true
          break
        }

        for (const row of data ?? []) {
          totals.set(row.request_id, (totals.get(row.request_id) ?? 0) + 1)
          if (row.listing_id === listingId) alreadyForThisListing.add(row.request_id)
        }
      }

      if (historyFailed) return

      const fresh = matched.filter(
        (request) =>
          !alreadyForThisListing.has(request.id) &&
          (totals.get(request.id) ?? 0) < LIFETIME_ALERT_CAP
      )

      if (fresh.length) {
        const { error } = await supabase.from('request_match_alerts').upsert(
          fresh.map((request) => ({ request_id: request.id, listing_id: listingId })),
          { onConflict: 'request_id,listing_id', ignoreDuplicates: true }
        )

        if (error) {
          console.warn('[alerts] alert insert failed, code:', error.code ?? 'unknown')
          return
        }

        inserted = fresh.length
      }
    }

    /**
     * Everything still unsent for this listing — the rows just written AND any row an
     * earlier publish wrote but could not deliver. That is the retry path, and it is why
     * this reads the table back instead of mailing the list it just built.
     */
    const {
      data: pendingRows,
      error: pendingError,
      count,
    } = await supabase
      .from('request_match_alerts')
      .select('request_id, property_requests ( email, is_handled )', { count: 'exact' })
      .eq('listing_id', listingId)
      .is('sent_at', null)
      .order('created_at', { ascending: true })
      .limit(SEND_CAP_PER_PUBLISH)

    if (pendingError) {
      console.warn('[alerts] pending read failed, code:', pendingError.code ?? 'unknown')
      return
    }

    const pending = (pendingRows ?? []) as unknown as {
      request_id: string
      property_requests: { email: string; is_handled: boolean } | null
    }[]

    const deferred = Math.max(0, (count ?? pending.length) - pending.length)
    let sent = 0

    for (const row of pending) {
      // A ledger row can outlive its request's welcome: confirmed → publish wrote the
      // row → the send failed → the person unsubscribed. The retry on the next publish
      // must not mail somebody who has since said stop.
      if (row.property_requests?.is_handled) continue

      const address = row.property_requests?.email
      if (!address) continue

      const delivered = await sendEmail({
        to: address,
        // Static. Nothing anybody typed goes in a subject line.
        subject: 'A new DaScout listing matches your request',
        text: alertBody(listing, row.request_id),
      })

      if (!delivered) continue

      const { error } = await supabase
        .from('request_match_alerts')
        .update({ sent_at: new Date().toISOString() })
        .eq('request_id', row.request_id)
        .eq('listing_id', listingId)

      if (error) {
        // The message went out. Not recording that is a duplicate on the next publish,
        // which is worth knowing about but not worth stopping for.
        console.warn('[alerts] sent_at not recorded, code:', error.code ?? 'unknown')
      }

      sent += 1
    }

    console.info(
      `[alerts] listing ${listingId}: matched ${matched.length}, new ${inserted}, sent ${sent}, deferred ${deferred}`
    )
  } catch (error) {
    console.warn(
      '[alerts] run failed:',
      error instanceof Error ? error.name : 'unknown error'
    )
  }
}
