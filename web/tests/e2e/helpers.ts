import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { BrowserContext, Page } from '@playwright/test'
import type { Database } from '@/lib/database.types'

/**
 * Shared plumbing for the Playwright suite. Runs against `next build && next
 * start` on port 3000 (see playwright.config.ts) — not `next dev` — because
 * the sitemap/revalidation criteria only prove out under a production server.
 */

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name}. Load .env.local before running e2e.`)
  return value
}

export function directClient(): SupabaseClient<Database> {
  return createClient<Database>(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false },
  })
}

export async function staffDirectClient(): Promise<SupabaseClient<Database>> {
  const client = directClient()
  const { error } = await client.auth.signInWithPassword({
    email: env('TEST_STAFF_EMAIL'),
    password: env('TEST_STAFF_PASSWORD'),
  })
  if (error) throw new Error(`Staff sign-in (direct client) failed: ${error.message}`)
  return client
}

/** Signs a Playwright page in as staff through the real UI form (proves AC-1 along the way). */
export async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/admin/sign-in')
  await page.getByLabel('Email').fill(env('TEST_STAFF_EMAIL'))
  await page.getByLabel('Password').fill(env('TEST_STAFF_PASSWORD'))
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL('**/admin')
}

export async function signInAsBuyer(page: Page): Promise<void> {
  await page.goto('/admin/sign-in')
  await page.getByLabel('Email').fill(env('TEST_BUYER_EMAIL'))
  await page.getByLabel('Password').fill(env('TEST_BUYER_PASSWORD'))
  await page.getByRole('button', { name: /sign in/i }).click()
}

/** A real, authenticated buyer supabase-js session, for direct-DB fixture setup/assertions. */
export async function buyerDirectClient(): Promise<SupabaseClient<Database>> {
  const client = directClient()
  const { error } = await client.auth.signInWithPassword({
    email: env('TEST_BUYER_EMAIL'),
    password: env('TEST_BUYER_PASSWORD'),
  })
  if (error) throw new Error(`Buyer sign-in (direct client) failed: ${error.message}`)
  return client
}

export async function userId(client: SupabaseClient<Database>): Promise<string> {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Client has no authenticated user.')
  return user.id
}

/**
 * Opens the PUBLIC auth dialog on whatever page is currently loaded — the same door
 * every buyer uses, never `/admin/sign-in`. Reuses the app's own `?auth=` bounce
 * mechanism (the same one `/auth/callback` uses to reopen the dialog after a failed
 * link) rather than clicking the header's "Sign In" button, because that button is
 * only rendered when nobody is signed in yet — the callback query string opens the
 * dialog unconditionally, which is what a "second person signs in without the first
 * signing out" shared-browser scenario needs (C.14).
 */
export async function openAuthTab(page: Page, tab: 'login' | 'register' | 'forgot' = 'login'): Promise<void> {
  await page.goto(`/?auth=${tab}`)
  await page.waitForSelector('dialog[aria-labelledby="authH"][open]')
}

/** Signs in through the real public modal (never `/admin/sign-in`) as either fixture. */
export async function signInViaModal(
  page: Page,
  role: 'buyer' | 'staff',
  options: { alreadyOpen?: boolean } = {}
): Promise<void> {
  if (!options.alreadyOpen) await openAuthTab(page, 'login')
  const email = role === 'buyer' ? env('TEST_BUYER_EMAIL') : env('TEST_STAFF_EMAIL')
  const password = role === 'buyer' ? env('TEST_BUYER_PASSWORD') : env('TEST_STAFF_PASSWORD')
  await page.locator('#li-user').fill(email)
  await page.locator('#li-pass').fill(password)
  await page.locator('dialog[open] button.mbtn[type="submit"]').click()
  await page.waitForLoadState('networkidle')
}

/** Reads one `localStorage` key as parsed JSON (or `null`) from the current page. */
export async function readLocalStorageJson<T>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((k) => {
    const raw = window.localStorage.getItem(k)
    return raw ? (JSON.parse(raw) as unknown) : null
  }, key) as Promise<T | null>
}

/** Writes one `localStorage` key as JSON on the current page (must be called after `page.goto`). */
export async function writeLocalStorageJson(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(({ k, v }) => window.localStorage.setItem(k, JSON.stringify(v)), { k: key, v: value })
}

export function zzTitle(suffix: string): string {
  return `ZZ Test ${suffix} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * A unique email for a ZZ-prefixed test fixture. `.invalid` is the RFC 2606 TLD reserved
 * to never resolve — nothing sent there ever reaches a real mailbox, which matters because
 * (BT finding, see the BT report) `RESEND_API_KEY` is actually configured in this
 * environment's `.env.local`, so `sendEmail` really attempts a send rather than skipping.
 */
export function zzEmail(suffix: string): string {
  const slug = suffix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `zz-bt-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@dascout-test.invalid`
}

export function zzSlug(suffix: string): string {
  const base = suffix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `zz-test-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * A minimal LIVE listing, built directly through a staff supabase-js session rather than
 * the admin UI — the account suite needs a resolvable, publicly-readable listing as a
 * fixture, not a proof of the publish workflow (that is 03-listing-journey's job).
 *
 * It still walks the real lifecycle graph, because since
 * 20260803110000_listing_encoding_v2_apply2.sql `guard_listing_publish` enforces that
 * graph in the database: `list -> live` in one hop is refused for a direct session
 * exactly as it is for the admin screen. The shortcut here is skipping the UI, not
 * skipping approval.
 */
export async function createLiveListing(
  staff: SupabaseClient<Database>,
  staffId: string,
  suffix: string
): Promise<{ id: string; slug: string }> {
  const { data: town, error: townError } = await staff.from('towns').select('id').limit(1).single()
  if (townError) throw townError

  const { data: type, error: typeError } = await staff
    .from('property_types')
    .select('id')
    .eq('slug', 'rlot')
    .single()
  if (typeError) throw typeError

  const slug = zzSlug(suffix)
  const { data: listing, error } = await staff
    .from('listings')
    .insert({
      title: zzTitle(suffix),
      slug,
      property_type_id: type.id,
      price_php: 100000,
      town_id: town.id,
      status: 'list',
      created_by: staffId,
    })
    .select('id')
    .single()
  if (error) throw error
  const id = listing.id as string

  for (const status of ['for_approval', 'live'] as const) {
    const { error: hopError } = await staff.from('listings').update({ status }).eq('id', id)
    if (hopError) throw hopError
  }

  return { id, slug }
}

/**
 * Withdraws a listing built by `createLiveListing`, then deletes it.
 *
 * The delete used to be impossible: `verification_events.listing_id` was ON DELETE
 * RESTRICT, so any fixture that had been through the publish path was a permanent
 * residual. That table is gone as of listing encoding v2 apply 2, and every remaining
 * foreign key into `listings` cascades — so cleanup can actually clean up. Withdraw
 * first regardless, so a failed delete leaves something invisible rather than public.
 */
export async function withdrawListing(staff: SupabaseClient<Database>, id: string): Promise<void> {
  const { error } = await staff.from('listings').update({ status: 'withdrawn' }).eq('id', id)
  if (error) console.warn(`[cleanup] could not withdraw fixture listing ${id}: ${error.message}`)

  const { error: deleteError } = await staff.from('listings').delete().eq('id', id)
  if (deleteError) console.warn(`[residual-listing] fixture ${id}: ${deleteError.message}`)
}

/**
 * Builds a large (>2000px) noise-filled JPEG entirely in the browser via canvas,
 * per the dispatch's fixture instruction. Noise compresses poorly, so the source
 * file lands comfortably multi-megabyte at full resolution — a real test of the
 * client-side downscale-then-cap pipeline (AC-14).
 */
export async function generateLargeJpeg(
  page: Page,
  width = 4000,
  height = 3000
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const dataUrl = await page.evaluate(
    ({ width, height }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      const imageData = ctx.createImageData(width, height)
      // Random noise: worst case for JPEG compression, guarantees a large file.
      const buf = new Uint32Array(imageData.data.buffer)
      for (let i = 0; i < buf.length; i++) buf[i] = (Math.random() * 0xffffffff) >>> 0
      ctx.putImageData(imageData, 0, 0)
      return canvas.toDataURL('image/jpeg', 0.92)
    },
    { width, height }
  )
  const base64 = dataUrl.split(',')[1]
  return { buffer: Buffer.from(base64, 'base64'), width, height }
}

/** A tiny valid JPEG, for cases that just need *a* photo without size being the point. */
export async function generateSmallJpeg(page: Page): Promise<Buffer> {
  const { buffer } = await generateLargeJpeg(page, 400, 300)
  return buffer
}

const MAX_COOKIE_CHUNK = 3180

/**
 * Establishes a buyer session on a Playwright browser context *without* the
 * admin sign-in form — which actively signs a non-staff user back out — by
 * signing in through supabase-js directly and writing the exact cookie
 * `@supabase/ssr` would have written itself (`sb-<project-ref>-auth-token`,
 * `base64-` + base64url(JSON), chunked past 3180 chars). This is what a real
 * signed-in buyer's cookie jar looks like, so AC-4's "signed-in buyer hits
 * /admin" premise is genuine, not simulated by skipping auth entirely.
 */
export async function seedBuyerSessionCookie(context: BrowserContext): Promise<void> {
  const url = env('NEXT_PUBLIC_SUPABASE_URL')
  const key = env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  const client = createClient<Database>(url, key, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword({
    email: env('TEST_BUYER_EMAIL'),
    password: env('TEST_BUYER_PASSWORD'),
  })
  if (error || !data.session) throw new Error(`Buyer sign-in (direct) failed: ${error?.message}`)

  const projectRef = new URL(url).hostname.split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`
  const encoded = 'base64-' + Buffer.from(JSON.stringify(data.session), 'utf-8').toString('base64url')

  const chunks: { name: string; value: string }[] =
    encoded.length <= MAX_COOKIE_CHUNK
      ? [{ name: cookieName, value: encoded }]
      : Array.from({ length: Math.ceil(encoded.length / MAX_COOKIE_CHUNK) }, (_, i) => ({
          name: `${cookieName}.${i}`,
          value: encoded.slice(i * MAX_COOKIE_CHUNK, (i + 1) * MAX_COOKIE_CHUNK),
        }))

  await context.addCookies(
    chunks.map(({ name, value }) => ({
      name,
      value,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    }))
  )
}
