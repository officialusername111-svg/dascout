import { describe, it, expect, afterAll } from 'vitest'
import { staffClient } from './helpers'
import { DRAFT_BUCKET, PUBLIC_BUCKET } from '@/lib/admin/photos'

/**
 * AC-31, general mechanic — proven without a real listing lifecycle (the full
 * lifecycle version, through an actual publish + withdraw, is in the
 * Playwright e2e suite). A public Supabase Storage bucket serves any object
 * by URL regardless of RLS on the owning row (PHASE-4-BRIEF trap #2); a
 * private bucket's `/object/public/` route denies regardless of who is
 * asking, which is what makes the two-bucket scheme work at all.
 */
describe('storage buckets: draft denies anon, public serves (AC-31 general mechanic)', () => {
  const path = `bt-fixtures/${crypto.randomUUID()}.png`
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  // 1x1 transparent PNG, valid bytes accepted by the bucket's image/png mime rule.
  const onePixelPng = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    ),
    (c) => c.charCodeAt(0)
  )

  afterAll(async () => {
    const staff = await staffClient()
    // Whichever bucket the object ended up in by the time the suite finishes.
    await staff.storage.from(PUBLIC_BUCKET).remove([path])
    await staff.storage.from(DRAFT_BUCKET).remove([path])
  })

  it('draft-bucket object: anon direct URL fetch is denied (>=400, no bytes)', async () => {
    const staff = await staffClient()
    const { error: uploadError } = await staff.storage
      .from(DRAFT_BUCKET)
      .upload(path, onePixelPng, { contentType: 'image/png', upsert: false })
    expect(uploadError).toBeNull()

    const response = await fetch(`${baseUrl}/storage/v1/object/public/${DRAFT_BUCKET}/${path}`)
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it('the same object moved to the public bucket: anon direct URL fetch returns 200', async () => {
    const staff = await staffClient()
    const { error: moveError } = await staff.storage
      .from(DRAFT_BUCKET)
      .move(path, path, { destinationBucket: PUBLIC_BUCKET })
    expect(moveError).toBeNull()

    const response = await fetch(`${baseUrl}/storage/v1/object/public/${PUBLIC_BUCKET}/${path}`)
    expect(response.status).toBe(200)
  })
})
