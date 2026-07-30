import { defineConfig } from '@playwright/test'
import { config } from 'dotenv'
import path from 'node:path'

// The Playwright test *process* needs the same TEST_STAFF_*/TEST_BUYER_* creds
// the Next server reads from .env.local automatically — load them here too.
config({ path: path.resolve(__dirname, '.env.local') })

/**
 * Minimal Playwright config. Run against `npm run build && npm run start` (port 3000),
 * never `next dev` — the sitemap/revalidation criteria (AC-25, AC-28b) are only provable
 * under a production server, per the run dispatch. The harness starts/stops that server
 * itself in the test run (see tests/e2e/README notes in the BT report); this config does
 * not start a webServer automatically so the runner controls the build/start lifecycle
 * explicitly and can assert on server logs if needed.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    trace: 'retain-on-failure',
  },
  // `npm run build` must already have been run by hand before this suite starts —
  // Playwright only manages start/stop of the production server, on the port the
  // sitemap/revalidation criteria require (never `next dev`).
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
