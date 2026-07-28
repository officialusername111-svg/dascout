import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/database.types'

/**
 * Supabase client for server components, route handlers and server actions.
 * Reads the session from cookies, so row-level security sees the real user.
 *
 * Uses the publishable key on purpose — the service role key must never be
 * used in code that renders pages, or RLS stops protecting anything.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a server component, where cookies are read-only.
            // The proxy refreshes the session instead, so this is safe to ignore.
          }
        },
      },
    }
  )
}
