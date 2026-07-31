'use server'

import { createHash, randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { after } from 'next/server'
import * as z from 'zod'
import { createClient } from '@/lib/supabase/server'
import { describeBudget, parsePesoBudget } from '@/lib/budget'
import { CATEGORIES, CATEGORY_KEYS, type CategoryKey } from '@/lib/categories'
import { sendEmail } from '@/lib/email'
import { peso } from '@/lib/format'
import { SITE_URL } from '@/lib/site'
import type { ActionResult } from '@/app/admin/actions'

const VIEW_SESSION_COOKIE = 'ds-vs'
const ONE_YEAR = 60 * 60 * 24 * 365

/** Postgres duplicate-key. Here it means "already counted today", which is the point. */
const UNIQUE_VIOLATION = '23505'

/** What the request throttle trigger raises. PostgREST passes the SQLSTATE through. */
const CHECK_VIOLATION = '23514'

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

// ---------------------------------------------------------------------------
// Property requests — "can't find it? request it."
// ---------------------------------------------------------------------------

/**
 * The one sentence this form ever says back on success.
 *
 * It is uniform on purpose and echoes nothing the visitor typed. Nobody who fills this
 * in learns whether their address has been used before, whether a throttle just dropped
 * their submission, or how many requests DaScout is holding — and a page that reflected
 * their own text back at them would be one more surface to get output encoding wrong on.
 */
const REQUEST_RECEIVED =
  "Got it — we'll email you when a matching verified listing goes live."

const REQUEST_FAILED = 'That did not go through. Try again.'

/**
 * The two sentences the database throttle raises. Matched on text rather than on the
 * SQLSTATE alone because `property_requests` carries an ordinary CHECK constraint too
 * (budget_max >= budget_min), and a real constraint failure must NOT be reported to the
 * visitor as a success.
 */
const THROTTLE_MARKERS: { marker: string; cap: string }[] = [
  { marker: 'too many property requests', cap: 'per-email (3/hour)' },
  { marker: 'briefly paused', cap: 'site-wide (30/hour)' },
]

const RequestSchema = z.object({
  category: z.enum(CATEGORY_KEYS as [CategoryKey, ...CategoryKey[]], {
    error: 'Choose one of the five property types.',
  }),
  preferred_town: z
    .string({ error: 'Tell us where you are looking.' })
    .trim()
    .min(1, { error: 'Tell us where you are looking.' })
    .max(120, { error: 'Keep the location under 120 characters.' }),
  budget: z
    .string()
    .trim()
    .max(40, { error: 'Keep the budget short — "2M – 6M" or "5M".' })
    .refine((value) => parsePesoBudget(value) !== null, {
      error: 'We could not read that budget. Try something like "2M – 6M", "5M" or "2M+".',
    }),
  notes: z
    .string()
    .trim()
    .max(2000, { error: 'Keep the details under 2000 characters.' }),
  email: z
    .string({ error: 'Enter your email address.' })
    .trim()
    .toLowerCase()
    .max(254, { error: 'That email address is too long.' })
    .pipe(z.email({ error: 'Enter a valid email so we can notify you.' })),
})

/** Local copy of the admin module's helper — `'use server'` will not let it be shared. */
function invalidRequest(error: z.ZodError, values: Record<string, string>): ActionResult {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field !== 'string' || field in fieldErrors) continue
    fieldErrors[field] = issue.message
  }

  return {
    ok: false,
    code: 'validation',
    message: error.issues.find((issue) => issue.path.length === 0)?.message
      ?? 'Some of the details need fixing.',
    fieldErrors,
    values,
  }
}

/** The posted strings, ready to be handed back to a form that has to redraw itself. */
function postedStrings(raw: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [field, value] of Object.entries(raw)) {
    if (typeof value === 'string') values[field] = value
  }
  return values
}

/**
 * Files a saved property request from the public dialog.
 *
 * Four things here are deliberate:
 *
 * 1. The throttles are the database's, not this function's — a BEFORE INSERT trigger
 *    caps three per hour per address and thirty per hour site-wide. When one fires,
 *    the visitor gets the SAME sentence as a clean insert and the server log gets the
 *    cap that tripped. Telling them "you have sent too many" would confirm, to anyone
 *    who cared to try, which addresses have already been used here.
 * 2. `profile_id` comes from the session and never from the form. A signed-in visitor's
 *    request is theirs to see later; an anonymous one belongs to nobody.
 * 3. The team notification runs in `after()`, so a slow or dead mail provider cannot
 *    hold the visitor's dialog open, and it runs ONLY for a row that was really
 *    written — a silently dropped throttle sends nothing.
 * 4. The success sentence is fixed text. Nothing the visitor typed comes back out.
 */
export async function submitPropertyRequest(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const raw = {
    category: formData.get('category'),
    preferred_town: formData.get('preferred_town'),
    budget: formData.get('budget') ?? '',
    notes: formData.get('notes') ?? '',
    email: formData.get('email'),
  }

  const parsed = RequestSchema.safeParse(raw)
  if (!parsed.success) return invalidRequest(parsed.error, postedStrings(raw))

  const { category, preferred_town, budget, notes, email } = parsed.data

  // Already proven parseable by the schema; the schema cannot carry the value across.
  const range = parsePesoBudget(budget) ?? { min: null, max: null }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase.from('property_requests').insert({
    email,
    category: CATEGORIES[category].db,
    preferred_town,
    budget_min: range.min,
    budget_max: range.max,
    notes: notes || null,
    profile_id: user?.id ?? null,
  })

  if (error) {
    const message = (error.message ?? '').toLowerCase()
    const throttle = THROTTLE_MARKERS.find((entry) => message.includes(entry.marker))

    if (error.code === CHECK_VIOLATION && throttle) {
      // Which cap, never whose address.
      console.warn('[requests] throttled, cap:', throttle.cap)
      return { ok: true, message: REQUEST_RECEIVED }
    }

    console.warn('[requests] insert failed, code:', error.code ?? 'unknown')
    return { ok: false, code: 'unexpected', message: REQUEST_FAILED }
  }

  const notify = process.env.REQUEST_NOTIFY_TO

  after(async () => {
    if (!notify) {
      console.warn('[requests] REQUEST_NOTIFY_TO is not set — no team notification sent.')
      return
    }

    await sendEmail({
      to: notify,
      // Static. A subject line built from someone's typing is a subject line
      // somebody can write for us.
      subject: 'New property request on DaScout',
      text: [
        'A visitor filed a property request on DaScout.',
        '',
        `Property type: ${CATEGORIES[category].label}`,
        `Preferred location: ${preferred_town}`,
        `Budget: ${describeBudget(range.min, range.max, peso)}`,
        `Details: ${notes || 'none given'}`,
        `Their email: ${email}`,
        '',
        `All requests: ${SITE_URL}/admin/requests`,
      ].join('\n'),
    })
  })

  return { ok: true, message: REQUEST_RECEIVED }
}
