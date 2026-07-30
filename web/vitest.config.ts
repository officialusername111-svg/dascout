import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Minimal Vitest config for the BT-bootstrapped integration/unit suite.
 * `tests/vitest` holds real-session Supabase integration tests; `.env.local`
 * carries the hosted project URL/key and the two test-account credentials.
 * No mocking layer — these tests talk to the real hosted Supabase project
 * under RLS, which is the whole point (per run-p4-admin addendum #13).
 */
export default defineConfig({
  test: {
    include: ['tests/vitest/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/vitest/setup-env.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
