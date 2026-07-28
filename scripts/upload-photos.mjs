/**
 * One-off: push the mockup's photos into the Supabase `listing-photos` bucket.
 *
 * The listing_photos rows already point at keys like `lots/l09.jpg` and
 * `houses/h08.jpg`. This uploads the matching files from ../assets so those
 * keys resolve.
 *
 * Needs the SERVICE ROLE key because the storage policy only lets staff write,
 * and there are no staff accounts yet. That key bypasses row-level security —
 * keep it in .env.local, never in git, and never ship it to a browser.
 *
 *   cd dascout/scripts
 *   npm install            # once
 *   node upload-photos.mjs         # add --dry-run to see what it would do
 */

import { createClient } from '@supabase/supabase-js'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(here, '..', 'assets')
const BUCKET = 'listing-photos'
const DRY_RUN = process.argv.includes('--dry-run')

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
    'Copy .env.example to .env.local, fill both in, then run:\n' +
    '  node --env-file=.env.local upload-photos.mjs'
  )
  process.exit(1)
}

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
})

/** every storage key the database expects, in one query */
async function keysTheDatabaseExpects() {
  const { data, error } = await supabase
    .from('listing_photos')
    .select('storage_path')
  if (error) throw error
  return [...new Set(data.map((r) => r.storage_path))].sort()
}

/** map a storage key back to its file on disk: `lots/l09.jpg` -> assets/lots/l09.jpg */
function localPathFor(key) {
  return join(assetsDir, key)
}

async function main() {
  const keys = await keysTheDatabaseExpects()
  console.log(`${keys.length} distinct photo keys referenced by listing_photos`)

  const missing = []
  const uploaded = []
  const skipped = []

  for (const key of keys) {
    const local = localPathFor(key)
    if (!existsSync(local)) {
      missing.push(key)
      continue
    }

    if (DRY_RUN) {
      uploaded.push(key)
      continue
    }

    const body = await readFile(local)
    const contentType = CONTENT_TYPES[extname(key).toLowerCase()] ?? 'application/octet-stream'

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(key, body, { contentType, upsert: true, cacheControl: '31536000' })

    if (error) {
      console.error(`  failed ${key}: ${error.message}`)
      skipped.push(key)
    } else {
      uploaded.push(key)
      process.stdout.write('.')
    }
  }

  console.log('')
  console.log(`${DRY_RUN ? 'would upload' : 'uploaded'}: ${uploaded.length}`)
  if (skipped.length) console.log(`failed: ${skipped.length}`)
  if (missing.length) {
    console.log(`missing on disk (${missing.length}):`)
    missing.forEach((k) => console.log(`  ${k}`))
  }

  // Anything in assets/ that no listing references — useful to know before launch.
  const onDisk = []
  for (const sub of ['houses', 'lots']) {
    const dir = join(assetsDir, sub)
    if (!existsSync(dir)) continue
    for (const f of await readdir(dir)) onDisk.push(`${sub}/${f}`)
  }
  const unreferenced = onDisk.filter((k) => !keys.includes(k))
  if (unreferenced.length) {
    console.log(`\n${unreferenced.length} photo(s) in assets/ that no listing uses yet — not uploaded.`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
