import { test, expect } from '@playwright/test'
import {
  staffDirectClient,
  buyerDirectClient,
  userId,
  createLiveListing,
  withdrawListing,
  signInViaModal,
} from './helpers'

/**
 * D.16/D.20 — browsing history attribution and the account history page's union +
 * clear control. `recordListingView` attaches `profile_id` at INSERT time only
 * (CONTRACT.md §9), so the one way to prove it is to actually drive the property page
 * while signed in and then read the row back through the buyer's own session.
 */
test.describe('Browsing history (D.16, D.20)', () => {
  let staff: Awaited<ReturnType<typeof staffDirectClient>>
  let staffId: string
  let buyer: Awaited<ReturnType<typeof buyerDirectClient>>
  let buyerId: string
  let listing: { id: string; slug: string }

  test.beforeAll(async () => {
    staff = await staffDirectClient()
    staffId = await userId(staff)
    buyer = await buyerDirectClient()
    buyerId = await userId(buyer)
    listing = await createLiveListing(staff, staffId, 'history')
  })

  test.afterAll(async () => {
    await buyer.rpc('clear_my_listing_views')
    await withdrawListing(staff, listing.id)
    console.log(`[residual-listing] history fixture ${listing.id} ends withdrawn; has events, undeletable (RESTRICT).`)
  })

  test('D.16: viewing a property while signed in attributes the listing_views row to the buyer', async ({ page }) => {
    await page.goto('/')
    await signInViaModal(page, 'buyer')

    await page.goto(`/property/${listing.slug}`)
    await page.waitForLoadState('networkidle')

    await expect
      .poll(
        async () => {
          const { data } = await buyer
            .from('listing_views')
            .select('id')
            .eq('listing_id', listing.id)
            .eq('profile_id', buyerId)
          return (data ?? []).length
        },
        { timeout: 10_000 }
      )
      .toBeGreaterThan(0)
  })

  test('D.20: history page shows the account row, and clearing empties it (falls back to device-only)', async ({
    page,
  }) => {
    await page.goto('/')
    await signInViaModal(page, 'buyer')
    await page.goto(`/property/${listing.slug}`)
    await page.waitForLoadState('networkidle')

    await expect
      .poll(async () => {
        const { data } = await buyer.from('listing_views').select('id').eq('listing_id', listing.id).eq('profile_id', buyerId)
        return (data ?? []).length
      }, { timeout: 10_000 })
      .toBeGreaterThan(0)

    await page.goto('/account/history')
    const row = page.locator('.arow', { hasText: 'on your account' })
    await expect(row.first()).toBeVisible()

    await page.getByRole('button', { name: 'Clear browsing history' }).click()
    await expect(page.getByRole('button', { name: 'Clear browsing history' })).toHaveCount(0, { timeout: 10_000 })

    const stillCounted = await staff.from('listing_views').select('id').eq('listing_id', listing.id)
    expect((stillCounted.data ?? []).length).toBeGreaterThan(0)

    await expect
      .poll(
        async () => {
          const { data } = await staff
            .from('listing_views')
            .select('id')
            .eq('listing_id', listing.id)
            .eq('profile_id', buyerId)
          return data ?? []
        },
        { timeout: 10_000 }
      )
      .toEqual([])
  })
})
