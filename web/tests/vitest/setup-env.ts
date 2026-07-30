import { config } from 'dotenv'
import path from 'node:path'

// Vitest does not read Next's .env.local convention on its own — load it by hand
// so the integration suite sees NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY and
// the TEST_STAFF_*/TEST_BUYER_* credentials the same way `next dev` would.
config({ path: path.resolve(__dirname, '../../.env.local') })
