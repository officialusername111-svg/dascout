import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test'
import { signInAsStaff, staffDirectClient, zzTitle, generateSmallJpeg } from './helpers'

/**
 * A second, separate ZZ-test listing carried all the way to `sold`, kept
 * separate from the main journey fixture so AC-28a/AC-29b don't interact
 * with the withdraw/relist assertions there. Per the production-visibility
 * protocol this row ends `sold` on purpose — the orchestrator sweeps it.
 */
test.describe.serial('Sold path: live -> sold, sold is terminal (AC-28a, AC-29b)', () => {
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let listingId: string

  test.beforeAll(async ({ browser: b }) => {
    browser = b
    context = await browser.newContext()
    page = await context.newPage()
    await signInAsStaff(page)

    await page.goto('/admin/listings/new')
    const title = zzTitle('BT sold-path')
    await page.locator('#lf-title').fill(title)
    await page.locator('#lf-category').selectOption({ index: 1 })
    await page.locator('#lf-town').selectOption({ index: 1 })
    await page.locator('#lf-price').fill('1800000')
    await page.getByRole('button', { name: 'Create draft' }).click()
    await page.waitForURL(/\/admin\/listings\/[0-9a-f-]{36}$/)
    listingId = page.url().split('/').pop()!

    await page.getByRole('button', { name: 'Submit for approval' }).click()
    await page.getByRole('button', { name: /Yes — submit for approval/i }).click()

    const photo = await generateSmallJpeg(page)
    await page.locator('#photo-input').setInputFiles([{ name: 'sold-fixture.jpg', mimeType: 'image/jpeg', buffer: photo }])
    await expect(page.locator('.aqueue > div', { hasText: 'sold-fixture.jpg' })).toHaveClass(/good/, {
      timeout: 15_000,
    })

    // No fieldwork events to record any more — approval IS the move from For Approval to
    // Live (listing encoding v2 apply 2). A cover photo is the only remaining precondition.
    await page.reload()
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await page.getByRole('button', { name: /Yes — publish/i }).click()
    await expect(page.locator('.apanel:has(#lifecycleH) .fmsg.ok')).toContainText('Live')
  })

  test.afterAll(async () => {
    console.log(`[sold-fixture] listing ${listingId} ends sold — residual for orchestrator sweep.`)
    await context.close()
  })

  test('AC-28a: marking sold stamps sold_at', async () => {
    await page.getByRole('button', { name: 'Mark as sold' }).click()
    await page.getByRole('button', { name: /Yes — mark as sold/i }).click()
    await expect(page.locator('.apanel:has(#lifecycleH) .fmsg.ok')).toContainText('Sold')

    const staff = await staffDirectClient()
    const { data } = await staff.from('listings').select('status, sold_at').eq('id', listingId).single()
    expect(data!.status).toBe('sold')
    expect(data!.sold_at).not.toBeNull()
  })

  test('AC-29b: sold is terminal — no transitions offered at all', async () => {
    await page.reload()
    await expect(page.locator('.atrans')).toHaveCount(0)
    await expect(page.locator('.apanel:has(#lifecycleH) .empty', { hasText: 'This listing is sold' })).toBeVisible()
  })
})
