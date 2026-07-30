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

export function zzTitle(suffix: string): string {
  return `ZZ Test ${suffix} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
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
