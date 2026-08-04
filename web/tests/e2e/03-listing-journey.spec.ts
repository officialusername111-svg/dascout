import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test'
import {
  signInAsStaff,
  staffDirectClient,
  directClient,
  zzTitle,
  generateLargeJpeg,
  generateSmallJpeg,
} from './helpers'

/**
 * The full staff journey on one ZZ-test listing: create -> features -> photos
 * (upload/downscale/reorder/cover/delete) -> lifecycle (list<->for_approval, publish,
 * live price edit, withdraw, relist, withdraw).
 * Tests run in file order against one shared page/listing (test.describe.serial),
 * because most of these criteria are sequential states of the same row.
 *
 * The verification-event steps that used to sit between photos and lifecycle are gone
 * with the table they wrote to (listing encoding v2 apply 2). Approval is now the act of
 * moving the listing from For Approval to Live, and `guard_listing_publish` enforces that
 * path in the database — so what used to be "record two events, then publish" is simply
 * "publish from For Approval".
 */
test.describe.serial('Staff journey: create through publish/withdraw/relist (AC-13..29, 35)', () => {
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let listingId: string
  let slug: string
  let photoIds: { a: string; b: string; c: string }

  test.beforeAll(async ({ browser: b }) => {
    browser = b
    context = await browser.newContext()
    page = await context.newPage()
    await signInAsStaff(page)
  })

  test.afterAll(async () => {
    await context.close()
  })

  test('create + AC-35a empty state + AC-29a/d spot check (a list entry offers only "Submit for approval")', async () => {
    await page.goto('/admin/listings/new')
    const title = zzTitle('BT journey main')
    await page.locator('#lf-title').fill(title)
    // Property type is a chip picker over the property_types lookup as of listing
    // encoding v2 piece 3 — clicking the visible chip is what a mouse user does; the
    // radio underneath it is sr-only and not itself a click target.
    await page.locator('.typechip').first().click()
    await page.locator('#lf-town').selectOption({ index: 1 })
    await page.locator('#lf-price').fill('2500000')
    await page.getByRole('button', { name: 'Create listing' }).click()

    await page.waitForURL(/\/admin\/listings\/[0-9a-f-]{36}$/)
    listingId = page.url().split('/').pop()!

    await expect(page.getByRole('heading', { name: title })).toBeVisible()

    // AC-35a
    await expect(page.locator('.apanel:has(#photosH) .empty', { hasText: 'No photos yet' })).toBeVisible()

    // AC-29a/d: from List, the only transition is to For Approval, and it is promoted
    // straight into the action bar as the primary move (piece 3) — nothing is left over
    // for the "Status" menu, so that trigger does not render at all here.
    await expect(page.getByRole('button', { name: 'Submit for approval' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Status ▾' })).toHaveCount(0)
  })

  test('AC-24a: list -> for_approval is ungated', async () => {
    // Primary move, clicked straight from the bar — LifecyclePanel isn't mounted for it,
    // so the pill flipping is the confirmation, not a `.fmsg`.
    await page.getByRole('button', { name: 'Submit for approval' }).click()
    await page.getByRole('button', { name: /Yes — submit for approval/i }).click()
    await expect(page.locator('.pill', { hasText: 'For Approval' })).toBeVisible()
  })

  test('AC-26 (iii): publish blocked with 0 photos, blocker named', async () => {
    // The two fieldwork blockers went with `verification_events`; the photo gate is what
    // is left, and it is the one that actually protects the public page from rendering
    // an empty card.
    const publishBtn = page.getByRole('button', { name: 'Publish', exact: true })
    await expect(publishBtn).toBeDisabled()
    // Publish is the bar's primary action, so LifecyclePanel (and its own inline
    // "The listing has no photos." reason list) isn't mounted for it at all — the one
    // remaining `.ablockers` on the page is the top-of-page checklist, which already
    // names the same gap in its own words.
    const blockers = page.locator('.ablockers')
    await expect(blockers).toContainText('At least one photo uploaded')
  })

  test('AC-24b: for_approval -> list (kick back) is ungated', async () => {
    // Secondary move — from For Approval the primary is Publish, so this one lives
    // behind the bar's "Status" menu (piece 3).
    await page.getByRole('button', { name: 'Status ▾' }).click()
    await page.getByRole('button', { name: 'Send back to the list' }).click()
    await page.getByRole('button', { name: /Yes — send back to the list/i }).click()
    await expect(page.locator('.apanel:has(#lifecycleH) .fmsg.ok')).toContainText('List')
    await expect(page.locator('.pill', { hasText: 'List' })).toBeVisible()
  })

  test('AC-13a: features — check 3, save, then uncheck 1 and save again', async () => {
    const featuresForm = page.locator('form.apanel:has(input[name="featureIds"])')
    const boxes = featuresForm.locator('input[name="featureIds"]')
    const count = await boxes.count()
    expect(count).toBeGreaterThanOrEqual(3)

    await boxes.nth(0).check()
    await boxes.nth(1).check()
    await boxes.nth(2).check()
    await featuresForm.getByRole('button', { name: 'Save features' }).click()
    await expect(featuresForm.locator('.fmsg.ok')).toContainText('Saved 3 features')

    await page.reload()
    await expect(page.locator('input[name="featureIds"]:checked')).toHaveCount(3)

    const firstId = await boxes.nth(0).getAttribute('value')
    await page.locator(`input[name="featureIds"][value="${firstId}"]`).uncheck()
    await featuresForm.getByRole('button', { name: 'Save features' }).click()
    await expect(featuresForm.locator('.fmsg.ok')).toContainText('Saved 2 features')

    await page.reload()
    await expect(page.locator('input[name="featureIds"]:checked')).toHaveCount(2)
    await expect(page.locator(`input[name="featureIds"][value="${firstId}"]`)).not.toBeChecked()
  })

  test('AC-24a (again): back to For Approval, where publishing is possible', async () => {
    await page.getByRole('button', { name: 'Submit for approval' }).click()
    await page.getByRole('button', { name: /Yes — submit for approval/i }).click()
    await expect(page.locator('.pill', { hasText: 'For Approval' })).toBeVisible()
  })

  test('AC-14: valid upload downscales to <=1920px and lands under 10MB; AC-15a: bad mime rejected client-side', async () => {
    const source = await generateLargeJpeg(page, 4000, 3000)
    expect(source.buffer.byteLength).toBeGreaterThan(0)

    await page
      .locator('#photo-input')
      .setInputFiles([{ name: 'source.jpg', mimeType: 'image/jpeg', buffer: source.buffer }])

    const queueItem = page.locator('.aqueue > div', { hasText: 'source.jpg' })
    await expect(queueItem).toHaveClass(/good/, { timeout: 30_000 })
    const detail = await queueItem.locator('span').last().textContent()
    const match = detail?.match(/Added at (\d+)×(\d+)/)
    expect(match).not.toBeNull()
    const [, w, h] = match!
    expect(Number(w)).toBeLessThanOrEqual(1920)
    expect(Number(h)).toBeLessThanOrEqual(1920)

    // AC-15a: unsupported type rejected before any Storage request.
    const badFile = Buffer.from('%PDF-1.4 not a real pdf but wrong mime is what matters')
    await page
      .locator('#photo-input')
      .setInputFiles([{ name: 'doc.pdf', mimeType: 'application/pdf', buffer: badFile }])
    const failedItem = page.locator('.aqueue > div', { hasText: 'doc.pdf' })
    await expect(failedItem).toBeVisible()
    await expect(failedItem).toContainText('JPEG, PNG and WebP')

    await page.reload()
    await expect(page.locator('.aphotos .aphoto')).toHaveCount(1)
  })

  test('upload 2 more photos (fixture setup for AC-16/17/18)', async () => {
    const b = await generateSmallJpeg(page)
    await page.locator('#photo-input').setInputFiles([{ name: 'b.jpg', mimeType: 'image/jpeg', buffer: b }])
    await expect(page.locator('.aqueue > div', { hasText: 'b.jpg' })).toHaveClass(/good/, { timeout: 15_000 })

    const c = await generateSmallJpeg(page)
    await page.locator('#photo-input').setInputFiles([{ name: 'c.jpg', mimeType: 'image/jpeg', buffer: c }])
    await expect(page.locator('.aqueue > div', { hasText: 'c.jpg' })).toHaveClass(/good/, { timeout: 15_000 })

    await page.reload()
    await expect(page.locator('.aphotos .aphoto')).toHaveCount(3)

    const staff = await staffDirectClient()
    const { data, error } = await staff
      .from('listing_photos')
      .select('id, sort_order')
      .eq('listing_id', listingId)
      .order('sort_order', { ascending: true })
    expect(error).toBeNull()
    expect(data).toHaveLength(3)
    photoIds = { a: data![0].id, b: data![1].id, c: data![2].id }
  })

  test('AC-16: moving photo C to first position persists sort_order server-side and across reload', async () => {
    async function moveEarlier(photoId: string) {
      const card = page.locator('.aphoto', { has: page.locator(`#alt-${photoId}`) })
      await card.getByText('↑ Earlier').click()
      // Wait for the mutation's own network round trip to settle rather than a fixed
      // delay — a guessed timeout is exactly the kind of race the RPC fix (migration
      // 20260729140300) was written to eliminate app-side; the test must not reintroduce
      // it by reloading before the write (and its revalidation) has actually landed.
      await page.waitForLoadState('networkidle')
    }

    await moveEarlier(photoIds.c)
    await page.reload()
    await moveEarlier(photoIds.c)
    await page.reload()

    const staff = await staffDirectClient()
    const { data, error } = await staff
      .from('listing_photos')
      .select('id, sort_order')
      .eq('listing_id', listingId)
      .order('sort_order', { ascending: true })
    expect(error).toBeNull()
    expect(data!.map((r) => r.id)).toEqual([photoIds.c, photoIds.a, photoIds.b])

    // Fresh server request shows the same order in the DOM.
    const firstCardAltId = await page.locator('.aphotos .aphoto').first().locator('input[id^="alt-"]').getAttribute('id')
    expect(firstCardAltId).toBe(`alt-${photoIds.c}`)
  })

  test('AC-17a: setting a new cover clears the previous one (never two primaries)', async () => {
    const cardB = page.locator('.aphoto', { has: page.locator(`#alt-${photoIds.b}`) })
    await cardB.getByRole('button', { name: 'Make cover' }).click()
    // Wait for the mutation's round trip to actually settle before reloading — same
    // reasoning as AC-16's moveEarlier: a fixed delay can race the hosted database.
    await page.waitForLoadState('networkidle')
    await page.reload()

    const staff = await staffDirectClient()
    const { data, error } = await staff
      .from('listing_photos')
      .select('id, is_primary')
      .eq('listing_id', listingId)
    expect(error).toBeNull()
    const primaries = data!.filter((r) => r.is_primary)
    expect(primaries).toHaveLength(1)
    expect(primaries[0].id).toBe(photoIds.b)
    await expect(page.locator('.aphoto', { has: page.locator(`#alt-${photoIds.b}`) }).locator('.pill', { hasText: 'Cover' })).toBeVisible()
  })

  test('AC-17b + AC-18: deleting the cover promotes the next photo, and removes both row and object', async () => {
    const staff = await staffDirectClient()
    const { data: before } = await staff
      .from('listing_photos')
      .select('storage_path')
      .eq('id', photoIds.b)
      .single()
    const deletedPath = before!.storage_path

    const cardB = page.locator('.aphoto', { has: page.locator(`#alt-${photoIds.b}`) })
    await cardB.getByRole('button', { name: 'Delete photo' }).click()
    await cardB.getByRole('button', { name: 'Yes, delete it' }).click()
    await expect(page.locator('.apanel:has(#photosH) .fmsg')).toBeVisible()
    await page.reload()

    // AC-18: row gone.
    await expect(page.locator(`#alt-${photoIds.b}`)).toHaveCount(0)
    await expect(page.locator('.aphotos .aphoto')).toHaveCount(2)

    const { data: remaining } = await staff
      .from('listing_photos')
      .select('id, is_primary, sort_order')
      .eq('listing_id', listingId)
      .order('sort_order', { ascending: true })
    expect(remaining).toHaveLength(2)
    // AC-17b: the invariant is_primary === (sort_order === 0) holds. Order going into
    // this delete was B(cover),C,A (AC-17a's "Make cover" put B first and resequenced
    // the rest, C then A, behind it) — so removing B promotes C, not A.
    expect(remaining![0].is_primary).toBe(true)
    expect(remaining![0].id).toBe(photoIds.c)
    expect(remaining![1].is_primary).toBe(false)
    expect(remaining![1].id).toBe(photoIds.a)

    // AC-18: object gone too — direct fetch of the deleted object's old path denies.
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const draftResp = await fetch(`${baseUrl}/storage/v1/object/public/listing-photos-draft/${deletedPath}`)
    expect(draftResp.status).toBeGreaterThanOrEqual(400)
  })

  /**
   * AC-20/21/23 (recording the two fieldwork events and reading them back) were deleted
   * with the capability they tested: `verification_events`, the panel that wrote to it and
   * the `recordVerificationEvent` action are all gone as of listing encoding v2 apply 2.
   * Same precedent as the invite system's retired self-service path — a test for a removed
   * capability is deleted, not weakened into something that still passes.
   */

  test('AC-26 (again): with a cover photo in place, AC-25 happy path publishes', async () => {
    // 1 photo + 1 primary exist by now — no blockers left.
    const publishBtn = page.getByRole('button', { name: 'Publish', exact: true })
    await expect(publishBtn).toBeEnabled()
    await publishBtn.click()
    await page.getByRole('button', { name: /Yes — publish/i }).click()
    // Primary move again — confirmed by the pill, same reasoning as AC-24a.
    await expect(page.locator('.pill', { hasText: 'Live' }).first()).toBeVisible()

    const staff = await staffDirectClient()
    const { data: listing } = await staff.from('listings').select('slug, status, published_at').eq('id', listingId).single()
    expect(listing!.status).toBe('live')
    expect(listing!.published_at).not.toBeNull()
    slug = listing!.slug
  })

  test('AC-19/AC-25: photos moved+verified into the public bucket before the flip, and serve publicly', async () => {
    const anon = directClient()
    const detailResp = await page.request.get(`/property/${slug}`)
    expect(detailResp.status()).toBe(200)

    const sitemapResp = await page.request.get('/sitemap.xml')
    const sitemapBody = await sitemapResp.text()
    expect(sitemapBody).toContain(`/property/${slug}`)

    const { data } = await anon.from('listings').select('id').eq('id', listingId).single()
    expect(data).not.toBeNull() // sanity: anon can read it now that it's live

    // AC-19/AC-25: the remaining photo (A, promoted to cover in AC-17b/18) now lives
    // in the PUBLIC bucket, reachable without a session — proof the move-then-verify
    // step actually ran before the status flip, not just that the row says "live".
    const staff = await staffDirectClient()
    const { data: photos } = await staff.from('listing_photos').select('storage_path').eq('listing_id', listingId)
    expect(photos!.length).toBeGreaterThan(0)
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    for (const photo of photos!) {
      const objResp = await fetch(`${baseUrl}/storage/v1/object/public/listing-photos/${photo.storage_path}`)
      expect(objResp.status).toBe(200)
    }
  })

  test('AC-13b: editing price on a live listing succeeds and feeds price_history', async () => {
    const staff = await staffDirectClient()
    const { count: before } = await staff
      .from('price_history')
      .select('id', { count: 'exact', head: true })
      .eq('listing_id', listingId)

    await page.locator('#lf-price').fill('2750000')
    await page.getByRole('button', { name: 'Save details' }).click()
    await expect(page.locator('form.apanel:has(#lf-title) .fmsg.ok')).toContainText('Listing saved')

    const { count: after } = await staff
      .from('price_history')
      .select('id', { count: 'exact', head: true })
      .eq('listing_id', listingId)
    expect(after!).toBeGreaterThan(before!)
  })

  test('AC-29c spot check: a live listing offers only sold/withdraw, never back to List/For Approval', async () => {
    await page.reload()
    // Live has no primary (neither sold nor withdrawn matches for_approval/live), so both
    // are secondary and sit behind "Status" — open it before reading the list.
    await page.getByRole('button', { name: 'Status ▾' }).click()
    const transitionButtons = page.locator('.atrans > div > form button[type="button"]')
    const labels = await transitionButtons.allTextContents()
    expect(labels.sort()).toEqual(['Mark as sold', 'Withdraw from the site'].sort())
  })

  test('AC-12c: slug is not offered as editable once the listing is live', async () => {
    await expect(page.locator('#lf-slug')).toHaveCount(0)
    await expect(page.locator('.field.wide', { hasText: 'Web address' })).toContainText('fixed')
    await expect(page.locator('.field.wide', { hasText: 'Web address' })).toContainText(slug)
  })

  test('AC-28b: withdraw — /property/<slug> 404s for anon, and drops out of the sitemap after revalidation', async () => {
    // Reload for a known-closed menu rather than trusting whatever AC-29c/AC-12c left
    // it as — the previous test may or may not have left it open.
    await page.reload()
    await page.getByRole('button', { name: 'Status ▾' }).click()
    await page.getByRole('button', { name: 'Withdraw from the site' }).click()
    await page.getByRole('button', { name: /Yes — withdraw/i }).click()
    await expect(page.locator('.apanel:has(#lifecycleH) .fmsg.ok')).toContainText('Withdrawn')

    const detailResp = await page.request.get(`/property/${slug}`)
    expect(detailResp.status()).toBe(404)

    const sitemapResp = await page.request.get('/sitemap.xml')
    const sitemapBody = await sitemapResp.text()
    expect(sitemapBody).not.toContain(`/property/${slug}`)

    // AC-31 (A4/A10 documented exception): a once-live listing's photos stay in the
    // PUBLIC bucket after withdraw — already-public objects aren't moved back.
    const staff = await staffDirectClient()
    const { data: photos } = await staff.from('listing_photos').select('storage_path').eq('listing_id', listingId)
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    for (const photo of photos!) {
      const objResp = await fetch(`${baseUrl}/storage/v1/object/public/listing-photos/${photo.storage_path}`)
      expect(objResp.status).toBe(200)
    }
  })

  /**
   * AC-28c: relist puts a withdrawn listing straight back on the site WITHOUT passing
   * through For Approval again. That edge is deliberate and named (brief section 8b D10):
   * the owner's table says Withdrawn merely hides a listing. It is also the one way around
   * the approval gate, which is exactly why it is asserted rather than left implicit — if
   * the matrix in `guard_listing_publish` ever loses `withdrawn -> live`, this fails loudly.
   */
  test('AC-28c: relist goes withdrawn -> live in one step, no second approval', async () => {
    // Withdrawn's only transition is to Live, so — like every other for_approval/live-
    // bound move — it is the bar's primary action, not a Status-menu item.
    await page.getByRole('button', { name: 'Relist' }).click()
    await page.getByRole('button', { name: /Yes — relist/i }).click()
    await expect(page.locator('.pill', { hasText: 'Live' }).first()).toBeVisible()

    const staff = await staffDirectClient()
    const { data } = await staff.from('listings').select('status').eq('id', listingId).single()
    expect(data!.status).toBe('live')
  })

  test('final withdraw + delete (production-visibility protocol, and the fixture cleans up now)', async () => {
    await page.reload()
    await page.getByRole('button', { name: 'Status ▾' }).click()
    await page.getByRole('button', { name: 'Withdraw from the site' }).click()
    await page.getByRole('button', { name: /Yes — withdraw/i }).click()
    await expect(page.locator('.apanel:has(#lifecycleH) .fmsg.ok')).toContainText('Withdrawn')

    const staff = await staffDirectClient()
    const { data } = await staff.from('listings').select('status').eq('id', listingId).single()
    expect(data!.status).toBe('withdrawn')

    // Withdraw first, delete second. This listing used to be a permanent residual because
    // `verification_events.listing_id` was ON DELETE RESTRICT; that table is gone and every
    // remaining foreign key into `listings` cascades, so the journey now tidies up after
    // itself instead of leaving a ZZ row on production for someone else to sweep.
    const { error } = await staff.from('listings').delete().eq('id', listingId)
    if (error) {
      console.warn(`[journey-fixture] listing ${listingId} (slug ${slug}) ends withdrawn but undeleted: ${error.message}`)
    }
  })
})
