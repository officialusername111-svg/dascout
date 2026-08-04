import { test, expect } from '@playwright/test'
import { signInAsStaff, staffDirectClient, zzTitle } from './helpers'

/**
 * AC-34 — two staff sessions load the same listing; session 1 saves a price,
 * then session 2 (without reloading, so it still holds the pre-session-1
 * price) saves a different price. Final stored value is session 2's, and
 * both saves still feed price_history (explicit last-write-wins, no
 * conflict error — the v1 rule this run adopted).
 *
 * Both browser contexts sign in as the single seeded TEST_STAFF account —
 * "two sessions" here means two independent cookie jars/tabs, which is what
 * the last-write-wins mechanic actually depends on, not two distinct staff
 * identities.
 */
test.describe('Concurrent edit: last-write-wins on price (AC-34)', () => {
  test('session 2 wins; both changes land in price_history', async ({ browser }) => {
    const staff = await staffDirectClient()
    const { data: town } = await staff.from('towns').select('id').limit(1).single()
    const { data: type } = await staff.from('property_types').select('id').eq('slug', 'rlot').single()
    const title = zzTitle('BT concurrent edit')
    const { data: listing, error } = await staff
      .from('listings')
      .insert({
        title,
        slug: `zz-test-concurrent-${Date.now()}`,
        property_type_id: type!.id,
        price_php: 1000000,
        town_id: town!.id,
        status: 'list',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    const listingId = listing!.id

    const context1 = await browser.newContext()
    const context2 = await browser.newContext()
    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    try {
      await signInAsStaff(page1)
      await signInAsStaff(page2)

      await page1.goto(`/admin/listings/${listingId}`)
      await page2.goto(`/admin/listings/${listingId}`)

      // Session 1 saves first.
      await page1.locator('#lf-price').fill('1200000')
      await page1.getByRole('button', { name: 'Save details' }).click()
      await expect(page1.locator('form.apanel:has(#lf-title) .fmsg.ok')).toContainText('Listing saved')

      // Session 2 never reloaded — it still has the original 1,000,000 form state —
      // and saves a different value without knowing about session 1's write.
      await page2.locator('#lf-price').fill('1350000')
      await page2.getByRole('button', { name: 'Save details' }).click()
      await expect(page2.locator('form.apanel:has(#lf-title) .fmsg.ok')).toContainText('Listing saved')

      const { data: final } = await staff.from('listings').select('price_php').eq('id', listingId).single()
      expect(Number(final!.price_php)).toBe(1350000)

      const { data: history } = await staff
        .from('price_history')
        .select('new_price')
        .eq('listing_id', listingId)
        .order('changed_at', { ascending: true })
      expect(history!.length).toBeGreaterThanOrEqual(2)
    } finally {
      await context1.close()
      await context2.close()
      // Never left `list`; nothing holds a RESTRICT reference -> deletable cleanup.
      const { error: delError } = await staff.from('listings').delete().eq('id', listingId)
      if (delError) console.warn(`[cleanup] concurrent-edit fixture ${listingId}: ${delError.message}`)
    }
  })
})
