import { test, expect } from '@playwright/test'
import {
  staffDirectClient,
  buyerDirectClient,
  userId,
  createLiveListing,
  withdrawListing,
  signInViaModal,
  openAuthTab,
  readLocalStorageJson,
  writeLocalStorageJson,
} from './helpers'
import type { SyncMark } from '@/components/ui-state'

/**
 * C.9-15 — the merge is the phase's named risk (PLAN.md "Merge invariants"). Two real
 * LIVE listings are built directly through a staff session (same shortcut the Vitest RPC
 * suite uses) so the merge has something resolvable to work with; a third slug that
 * never existed plays the "withdrawn/gone" case union has to retain rather than drop.
 *
 * Every test gets Playwright's default fresh browser context (its own cookies AND its
 * own `localStorage`), and `beforeEach` empties the shared buyer fixture's `favorites`
 * rows directly — the account itself is shared across the whole suite (there is no way
 * to mint a second buyer, F2/F3), so each test has to start from a known, empty account
 * state rather than relying on context isolation alone.
 */
test.describe('Favourites merge (C.9-15)', () => {
  let staff: Awaited<ReturnType<typeof staffDirectClient>>
  let staffId: string
  let buyer: Awaited<ReturnType<typeof buyerDirectClient>>
  let buyerId: string
  let staffUid: string
  let listingA: { id: string; slug: string }
  let listingB: { id: string; slug: string }
  const FAKE_SLUG = 'zz-test-does-not-exist-anywhere-12345'

  test.beforeAll(async () => {
    staff = await staffDirectClient()
    staffId = await userId(staff)
    buyer = await buyerDirectClient()
    buyerId = await userId(buyer)
    staffUid = staffId

    listingA = await createLiveListing(staff, staffId, 'merge-a')
    listingB = await createLiveListing(staff, staffId, 'merge-b')
  })

  test.afterAll(async () => {
    await buyer.from('favorites').delete().eq('profile_id', buyerId)
    await staff.from('favorites').delete().eq('profile_id', staffUid)
    await withdrawListing(staff, listingA.id)
    await withdrawListing(staff, listingB.id)
    console.log(
      `[residual-listing] merge fixtures ${listingA.id}/${listingB.id} end withdrawn; have events, undeletable (RESTRICT).`
    )
  })

  test.beforeEach(async () => {
    await buyer.from('favorites').delete().eq('profile_id', buyerId)
    await staff.from('favorites').delete().eq('profile_id', staffId)
  })

  test('C.10: seeding 2 real slugs + 1 nonexistent slug, then signing in, merges both real ones onto the account and keeps the unresolved slug locally', async ({
    page,
  }) => {
    await page.goto('/')
    await writeLocalStorageJson(page, 'ds-favs', [listingA.slug, listingB.slug, FAKE_SLUG])

    await signInViaModal(page, 'buyer')
    await page.goto('/account/favorites')

    await expect(page.locator('.grid .card')).toHaveCount(2)
    await expect(page.getByText(/not currently listed/)).toContainText('1')

    const rows = await buyer.from('favorites').select('listing_id').eq('profile_id', buyerId)
    expect(rows.error).toBeNull()
    expect((rows.data ?? []).map((r) => r.listing_id).sort()).toEqual([listingA.id, listingB.id].sort())

    const localFavs = await readLocalStorageJson<string[]>(page, 'ds-favs')
    expect(localFavs).toContain(FAKE_SLUG)
  })

  test('C.11: idempotency — reloading twice does not create duplicate favourite rows', async ({ page }) => {
    await page.goto('/')
    await writeLocalStorageJson(page, 'ds-favs', [listingA.slug, listingB.slug, FAKE_SLUG])
    await signInViaModal(page, 'buyer')

    await page.goto('/account/favorites')
    await expect(page.locator('.grid .card')).toHaveCount(2)

    const firstCount = await buyer.from('favorites').select('listing_id', { count: 'exact', head: true }).eq('profile_id', buyerId)
    expect(firstCount.count).toBe(2)

    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.reload()

    const secondCount = await buyer.from('favorites').select('listing_id', { count: 'exact', head: true }).eq('profile_id', buyerId)
    expect(secondCount.count).toBe(2)
  })

  test('C.12: a favourite removed directly (buyer supabase-js session) does not come back after reload', async ({
    page,
  }) => {
    await page.goto('/')
    await writeLocalStorageJson(page, 'ds-favs', [listingA.slug, listingB.slug])
    await signInViaModal(page, 'buyer')
    await page.goto('/account/favorites')
    await expect(page.locator('.grid .card')).toHaveCount(2)

    const { error: deleteError } = await buyer
      .from('favorites')
      .delete()
      .eq('profile_id', buyerId)
      .eq('listing_id', listingA.id)
    expect(deleteError).toBeNull()

    await page.reload()
    await expect(page.locator('.grid .card')).toHaveCount(1)

    const remaining = await buyer.from('favorites').select('listing_id').eq('profile_id', buyerId)
    expect((remaining.data ?? []).map((r) => r.listing_id)).toEqual([listingB.id])
  })

  test('C.13: after sign-out, ds-favs contains ONLY the unresolved local slug — mirrored entries removed', async ({
    page,
  }) => {
    await page.goto('/')
    await writeLocalStorageJson(page, 'ds-favs', [listingA.slug, listingB.slug, FAKE_SLUG])
    await signInViaModal(page, 'buyer')
    await page.goto('/account/favorites')
    await expect(page.locator('.grid .card')).toHaveCount(2)

    await page.goto('/account')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.waitForURL('**/')

    const favs = await readLocalStorageJson<string[]>(page, 'ds-favs')
    expect(favs).toEqual([FAKE_SLUG])

    const sync = await page.evaluate(() => window.localStorage.getItem('ds-sync'))
    expect(sync).toBeNull()
    const hist = await page.evaluate(() => window.localStorage.getItem('ds-hist'))
    expect(hist).toBeNull()
  })

  test("C.14: a shared browser's mirrored slugs never land on the NEXT person's account (cross-account isolation)", async ({
    page,
  }) => {
    await page.goto('/')
    await writeLocalStorageJson(page, 'ds-favs', [listingA.slug, listingB.slug, FAKE_SLUG])
    await signInViaModal(page, 'buyer')
    await page.goto('/account/favorites')
    await expect(page.locator('.grid .card')).toHaveCount(2)

    const mark = await readLocalStorageJson<SyncMark>(page, 'ds-sync')
    expect(mark?.userId).toBeTruthy()
    expect(mark?.mirrored?.sort()).toEqual([listingA.slug, listingB.slug].sort())

    // The buyer never explicitly signs out here — this is the "left signed in on a
    // shared machine" case. `?auth=login` reopens the dialog regardless of who (if
    // anyone) is currently signed in, which is the only way to reach the sign-in form
    // without the header's Sign In button (hidden while someone is signed in).
    await openAuthTab(page, 'login')
    await page.locator('#li-user').fill(process.env.TEST_STAFF_EMAIL!)
    await page.locator('#li-pass').fill(process.env.TEST_STAFF_PASSWORD!)
    await page.locator('dialog[open] button.mbtn[type="submit"]').click()
    await page.waitForLoadState('networkidle')

    const staffRows = await staff
      .from('favorites')
      .select('listing_id')
      .eq('profile_id', staffId)
      .in('listing_id', [listingA.id, listingB.id])
    expect(staffRows.error).toBeNull()
    expect(staffRows.data ?? []).toEqual([])
  })

  test('LH-5: a favourited listing that sells renders as a Sold card — pill, no link, heart kept', async ({
    page,
  }) => {
    // Own fixture: the suite's shared A/B must stay live for the other tests. The guard
    // trigger only gates transitions TO live/sold and the fieldwork events exist, so a
    // direct staff UPDATE to sold is the same shortcut createLiveListing already uses;
    // afterwards withdrawListing (sold → withdrawn is ungated) retires it.
    const soldListing = await createLiveListing(staff, staffId, 'merge-sold')
    try {
      const { error: favError } = await buyer
        .from('favorites')
        .insert({ profile_id: buyerId, listing_id: soldListing.id })
      expect(favError).toBeNull()

      const { error: sellError } = await staff
        .from('listings')
        .update({ status: 'sold' })
        .eq('id', soldListing.id)
      expect(sellError).toBeNull()

      await page.goto('/')
      await signInViaModal(page, 'buyer')
      await page.goto('/account/favorites')

      // The card is still there — a sold favourite must not silently vanish — but it is
      // the history page's sold treatment in card form: a Sold pill and nothing to click
      // through to (the public property page is live-only and would 404).
      const card = page.locator('.grid .card')
      await expect(card).toHaveCount(1)
      await expect(card.locator('.pill')).toHaveText('Sold')
      await expect(card.locator('a')).toHaveCount(0)
      // The heart stays: unsaving a sold property must remain possible.
      await expect(card.locator('.fav')).toHaveCount(1)
    } finally {
      await buyer.from('favorites').delete().eq('listing_id', soldListing.id)
      await withdrawListing(staff, soldListing.id)
    }
  })

  test('C.15: toggling the heart on a property page saves and unsaves the row; double-toggle is not an error', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))

    await page.goto('/')
    await signInViaModal(page, 'buyer')

    await page.goto(`/property/${listingA.slug}`)
    await page.waitForLoadState('networkidle')
    const saveBtn = page.getByRole('button', { name: /Save to Favorites|Saved to Favorites/ })
    await saveBtn.scrollIntoViewIfNeeded()

    // `.click()` (a raw DOM dispatch, bypassing Playwright's hit-testing) rather than
    // Playwright's `locator.click()`: this page's sticky header/gallery placeholder
    // transiently intercepts pointer-event hit-testing during layout, which is a
    // rendering nuance unrelated to what this test is proving (the toggle itself, and
    // its round trip to the server). A native `.click()` still fires the real DOM event
    // React's delegated listener responds to.
    const clickSaveBtn = () => saveBtn.evaluate((el) => (el as HTMLElement).click())

    // The heart updates itself optimistically the instant the click handler runs; the
    // `setFavorite` server action that actually writes the row is a separate, slightly
    // later round trip (`startTransition`), so the DB assertion polls rather than
    // trusting `networkidle` to mean the write has landed.
    const rowExists = async () => {
      const { data } = await buyer
        .from('favorites')
        .select('listing_id')
        .eq('profile_id', buyerId)
        .eq('listing_id', listingA.id)
      return (data ?? []).length > 0
    }

    await clickSaveBtn()
    await expect(saveBtn).toHaveText(/Saved to Favorites/)
    await expect.poll(rowExists, { timeout: 10_000 }).toBe(true)

    await clickSaveBtn()
    await expect(saveBtn).toHaveText(/Save to Favorites/)
    await expect.poll(rowExists, { timeout: 10_000 }).toBe(false)

    // Double-toggle: save, unsave, save again in quick succession — no page error, and
    // the row ends up exactly once (no duplicate-key crash reaching the browser).
    await clickSaveBtn()
    await clickSaveBtn()
    await clickSaveBtn()
    await expect(saveBtn).toHaveText(/Saved to Favorites/)
    await expect.poll(rowExists, { timeout: 10_000 }).toBe(true)
    await page.waitForLoadState('networkidle')

    const finalRows = await buyer.from('favorites').select('listing_id').eq('profile_id', buyerId).eq('listing_id', listingA.id)
    expect(finalRows.data).toEqual([{ listing_id: listingA.id }])
    expect(errors).toEqual([])
  })
})
