import { test, expect } from '@playwright/test'
import { staffDirectClient, zzEmail } from './helpers'

/**
 * `/requests/unsubscribe` (R3): GET never mutates (mail-scanner prefetch safety), POST
 * confirms, and every outcome — good token, bad token, no token — renders the same
 * confirmation shape so the URL cannot be used to probe which request ids exist.
 */

async function makeRequest(email: string): Promise<string> {
  const staff = await staffDirectClient()
  const { data, error } = await staff
    .from('property_requests')
    .insert({
      email,
      category: 'residential_lot',
      preferred_town: 'ZZ Unsubscribe Town',
      is_handled: false,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function isHandled(id: string): Promise<boolean> {
  const staff = await staffDirectClient()
  const { data, error } = await staff.from('property_requests').select('is_handled').eq('id', id).single()
  if (error) throw error
  return data.is_handled
}

test.describe('Unsubscribe (R3)', () => {
  const cleanupIds: string[] = []

  test.afterAll(async () => {
    if (!cleanupIds.length) return
    const staff = await staffDirectClient()
    const { error } = await staff.from('property_requests').delete().in('id', cleanupIds)
    if (error) console.warn('[BT cleanup] unsubscribe rows delete failed:', error.message)
  })

  test('GET with a valid token shows the confirm form and does NOT mutate is_handled', async ({ page }) => {
    const id = await makeRequest(zzEmail('unsub-get'))
    cleanupIds.push(id)

    await page.goto(`/requests/unsubscribe?token=${id}`)
    await expect(page.getByRole('heading', { name: 'Stop alerts for this request?' })).toBeVisible()
    expect(await isHandled(id)).toBe(false)
  })

  test('POST (clicking the confirm button) sets is_handled and shows the confirmed page', async ({ page }) => {
    const id = await makeRequest(zzEmail('unsub-post'))
    cleanupIds.push(id)

    await page.goto(`/requests/unsubscribe?token=${id}`)
    await page.getByRole('button', { name: 'Stop these alerts' }).click()

    await expect(page).toHaveURL(/\/requests\/unsubscribe\?done=1/)
    // The token itself must not survive into the confirmed URL (cannot be bookmarked/shared/leaked via referrer).
    expect(page.url()).not.toContain(id)
    await expect(page.getByRole('heading', { name: 'Alerts stopped' })).toBeVisible()

    expect(await isHandled(id)).toBe(true)
  })

  test('a syntactically-valid but nonexistent token renders the identical confirmation — no enumeration signal', async ({
    page,
  }) => {
    const bogusUuid = '00000000-0000-4000-8000-000000000000'
    await page.goto(`/requests/unsubscribe?token=${bogusUuid}`)
    await page.getByRole('button', { name: 'Stop these alerts' }).click()
    await expect(page).toHaveURL(/\/requests\/unsubscribe\?done=1/)
    await expect(page.getByRole('heading', { name: 'Alerts stopped' })).toBeVisible()
  })

  test('a garbage (non-uuid) token also renders the identical confirmation, never an error page', async ({ page }) => {
    await page.goto('/requests/unsubscribe?token=not-a-uuid-at-all')
    await page.getByRole('button', { name: 'Stop these alerts' }).click()
    await expect(page).toHaveURL(/\/requests\/unsubscribe\?done=1/)
    await expect(page.getByRole('heading', { name: 'Alerts stopped' })).toBeVisible()
  })

  test('no token at all still renders the page (the confirm form, not a crash)', async ({ page }) => {
    const response = await page.goto('/requests/unsubscribe')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Stop alerts for this request?' })).toBeVisible()
  })
})
