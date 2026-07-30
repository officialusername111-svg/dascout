import { describe, it, expect } from 'vitest'
import { bucketForStatus, isValidPhotoPath, PUBLIC_BUCKET, DRAFT_BUCKET } from '@/lib/admin/photos'

/**
 * Pure unit tests — no DB, no network. `lib/admin/photos.ts` is explicitly
 * client-importable (no next/headers), so these run under plain Vitest/node.
 */

describe('bucketForStatus', () => {
  it.each([
    ['draft', DRAFT_BUCKET],
    ['verifying', DRAFT_BUCKET],
    ['live', PUBLIC_BUCKET],
    ['sold', PUBLIC_BUCKET],
    ['withdrawn', PUBLIC_BUCKET],
  ] as const)('%s -> %s', (status, expected) => {
    expect(bucketForStatus(status)).toBe(expected)
  })
})

describe('isValidPhotoPath', () => {
  const listingId = '11111111-1111-1111-1111-111111111111'

  it('accepts a well-formed new-scheme path for the matching listing', () => {
    const path = `listings/${listingId}/${crypto.randomUUID()}.jpg`
    expect(isValidPhotoPath(path, listingId)).toBe(true)
  })

  it('accepts webp and png extensions too', () => {
    expect(isValidPhotoPath(`listings/${listingId}/${crypto.randomUUID()}.webp`, listingId)).toBe(true)
    expect(isValidPhotoPath(`listings/${listingId}/${crypto.randomUUID()}.png`, listingId)).toBe(true)
  })

  it('rejects a path belonging to a different listing', () => {
    const other = '22222222-2222-2222-2222-222222222222'
    expect(isValidPhotoPath(`listings/${other}/${crypto.randomUUID()}.jpg`, listingId)).toBe(false)
  })

  it('rejects an unsupported extension', () => {
    expect(isValidPhotoPath(`listings/${listingId}/${crypto.randomUUID()}.gif`, listingId)).toBe(false)
  })

  it('rejects a legacy-scheme path (predates the listings/<id>/ convention)', () => {
    expect(isValidPhotoPath('houses/h08.jpg', listingId)).toBe(false)
  })

  it('rejects a malformed listingId', () => {
    expect(isValidPhotoPath(`listings/not-a-uuid/${crypto.randomUUID()}.jpg`, 'not-a-uuid')).toBe(false)
  })

  it('rejects a path missing the uuid filename', () => {
    expect(isValidPhotoPath(`listings/${listingId}/photo.jpg`, listingId)).toBe(false)
  })
})
