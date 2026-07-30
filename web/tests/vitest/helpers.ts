import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

/**
 * Real Supabase sessions for the integration suite — no mocking, per addendum #13.
 * Each helper signs in fresh so tests stay independent of each other's session state.
 */

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name} for the vitest integration suite.`)
  return value
}

const URL = () => env('NEXT_PUBLIC_SUPABASE_URL')
const KEY = () => env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')

export function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(URL(), KEY(), { auth: { persistSession: false } })
}

export async function staffClient(): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(URL(), KEY(), { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword({
    email: env('TEST_STAFF_EMAIL'),
    password: env('TEST_STAFF_PASSWORD'),
  })
  if (error) throw new Error(`Staff sign-in failed: ${error.message}`)
  return client
}

export async function buyerClient(): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(URL(), KEY(), { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword({
    email: env('TEST_BUYER_EMAIL'),
    password: env('TEST_BUYER_PASSWORD'),
  })
  if (error) throw new Error(`Buyer sign-in failed: ${error.message}`)
  return client
}

export async function staffUserId(client: SupabaseClient<Database>): Promise<string> {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Staff client has no authenticated user.')
  return user.id
}

/** A ZZ-prefixed fake title, per the production-visibility protocol. */
export function zzTitle(suffix: string): string {
  return `ZZ Test ${suffix} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/** `listings.slug` is NOT NULL with no default — every direct-insert fixture needs one. */
export function zzSlug(suffix: string): string {
  const base = suffix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `zz-test-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/** A valid uuid v4-shaped random id, for path/insert probes that need a plausible-but-fake id. */
export function fakeUuid(): string {
  return crypto.randomUUID()
}
