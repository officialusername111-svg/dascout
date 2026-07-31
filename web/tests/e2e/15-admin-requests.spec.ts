import { test, expect } from '@playwright/test'
import { signInAsStaff, seedBuyerSessionCookie, staffDirectClient, zzEmail } from './helpers'

/**
 * Slice E: `/admin/requests` (AC-17).
 */

test.describe('Admin requests surface (AC-17)', () => {
  const email = zzEmail('admin-page')
  let requestId: string

  test.beforeAll(async () => {
    const staff = await staffDirectClient()
    const { data, error } = await staff
      .from('property_requests')
      .insert({
        email,
        category: 'commercial_lot',
        preferred_town: 'ZZ Admin Page Town',
        budget_min: 3_000_000,
        budget_max: null,
        notes: 'ZZ admin-page notes <script>alert(1)</script>',
        is_handled: false,
      })
      .select('id')
      .single()
    if (error) throw error
    requestId = data.id
  })

  test.afterAll(async () => {
    const staff = await staffDirectClient()
    const { error } = await staff.from('property_requests').delete().eq('id', requestId)
    if (error) console.warn('[BT cleanup] admin-requests row delete failed:', error.message)
  })

  test('staff sees the request listed with parsed fields as plain text, and the nav link', async ({ page }) => {
    await signInAsStaff(page)
    await page.getByRole('link', { name: 'Requests' }).click()
    await expect(page).toHaveURL(/\/admin\/requests/)
    await expect(page.getByRole('heading', { name: 'Requests' })).toBeVisible()

    const row = page.locator('.arow', { hasText: email })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Commercial Lot')
    await expect(row).toContainText('ZZ Admin Page Town')
    await expect(row).toContainText('and up') // describeBudget(3_000_000, null, peso) -> "₱3,000,000 and up"
    await expect(row).toContainText('Open')

    // Security sweep (R11): notes render as a plain text node, never executed/parsed as
    // markup. If this were interpreted as HTML there would be no visible "<script>" text
    // and a real alert() would have fired; assert the literal characters are present.
    await expect(row).toContainText('<script>alert(1)</script>')
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })
    await page.waitForTimeout(300)
    expect(dialogs).toEqual([])
  })

  test('toggling handled flips is_handled and survives a reload', async ({ page }) => {
    await signInAsStaff(page)
    await page.goto('/admin/requests')
    const row = page.locator('.arow', { hasText: email })
    await expect(row.locator('.pill', { hasText: 'Open' })).toBeVisible()

    await row.getByRole('button', { name: 'Mark handled' }).click()
    await expect(row.locator('.pill', { hasText: 'Handled' })).toBeVisible()

    await page.reload()
    const rowAfterReload = page.locator('.arow', { hasText: email })
    await expect(rowAfterReload.locator('.pill', { hasText: 'Handled' })).toBeVisible()

    const staff = await staffDirectClient()
    const { data } = await staff.from('property_requests').select('is_handled').eq('id', requestId).single()
    expect(data!.is_handled).toBe(true)

    // Reopen, leaving state as found for the next run's determinism.
    await rowAfterReload.getByRole('button', { name: 'Reopen' }).click()
    await expect(page.locator('.arow', { hasText: email }).locator('.pill', { hasText: 'Open' })).toBeVisible()
  })

  test('a signed-in buyer (non-staff) is denied — redirected to sign-in, not the requests list', async ({
    page,
    context,
  }) => {
    await seedBuyerSessionCookie(context)
    const response = await page.goto('/admin/requests')
    expect(response?.status()).toBeLessThan(400)
    await expect(page).toHaveURL(/\/admin\/sign-in/)
    await expect(page.getByRole('heading', { name: 'Requests' })).toHaveCount(0)
  })

  test('a signed-out visitor is redirected to sign-in', async ({ page }) => {
    const response = await page.goto('/admin/requests')
    expect(response?.status()).toBeLessThan(400)
    await expect(page).toHaveURL(/\/admin\/sign-in/)
  })
})
