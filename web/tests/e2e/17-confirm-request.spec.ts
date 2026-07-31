import { test, expect } from '@playwright/test'
import { staffDirectClient, zzEmail } from './helpers'

/**
 * `/requests/confirm` (double opt-in): GET never mutates (mail-scanner prefetch safety),
 * POST confirms (idempotent — a second POST leaves the original timestamp untouched), and
 * every outcome — good token, bad token, no token — renders the same confirmation shape so
 * the URL cannot be used to probe which request ids exist. A literal mirror of
 * 16-unsubscribe.spec.ts's structure, per the confirm page/action's own doc comments
 * (`app/requests/confirm/page.tsx`, `app/requests/confirm/actions.ts`): same two rules,
 * different copy and RPC.
 */

async function makeRequest(email: string): Promise<string> {
  const staff = await staffDirectClient()
  const { data, error } = await staff
    .from('property_requests')
    .insert({
      email,
      category: 'residential_lot',
      preferred_town: 'ZZ Confirm Town',
      is_handled: false,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function confirmedAt(id: string): Promise<string | null> {
  const staff = await staffDirectClient()
  const { data, error } = await staff.from('property_requests').select('confirmed_at').eq('id', id).single()
  if (error) throw error
  return data.confirmed_at
}

test.describe('Confirm request (double opt-in)', () => {
  const cleanupIds: string[] = []

  test.afterAll(async () => {
    if (!cleanupIds.length) return
    const staff = await staffDirectClient()
    const { error } = await staff.from('property_requests').delete().in('id', cleanupIds)
    if (error) console.warn('[BT cleanup] confirm-request rows delete failed:', error.message)
  })

  test('GET with a valid token shows the confirm form and does NOT mutate confirmed_at', async ({ page }) => {
    const id = await makeRequest(zzEmail('confirm-get'))
    cleanupIds.push(id)

    await page.goto(`/requests/confirm?token=${id}`)
    await expect(page.getByRole('heading', { name: 'Confirm alerts for this request?' })).toBeVisible()
    expect(await confirmedAt(id)).toBeNull()
  })

  test('POST (clicking the confirm button) sets confirmed_at and shows the confirmed page', async ({ page }) => {
    const id = await makeRequest(zzEmail('confirm-post'))
    cleanupIds.push(id)

    await page.goto(`/requests/confirm?token=${id}`)
    await page.getByRole('button', { name: 'Confirm this request' }).click()

    await expect(page).toHaveURL(/\/requests\/confirm\?done=1/)
    // The token itself must not survive into the confirmed URL (cannot be bookmarked/shared/leaked via referrer).
    expect(page.url()).not.toContain(id)
    await expect(page.getByRole('heading', { name: 'Request confirmed' })).toBeVisible()

    expect(await confirmedAt(id)).not.toBeNull()
  })

  test('a second POST on an already-confirmed token is idempotent — the original timestamp survives', async ({
    page,
  }) => {
    const id = await makeRequest(zzEmail('confirm-idempotent'))
    cleanupIds.push(id)

    await page.goto(`/requests/confirm?token=${id}`)
    await page.getByRole('button', { name: 'Confirm this request' }).click()
    await expect(page).toHaveURL(/\/requests\/confirm\?done=1/)

    const firstTimestamp = await confirmedAt(id)
    expect(firstTimestamp).not.toBeNull()

    await page.goto(`/requests/confirm?token=${id}`)
    await page.getByRole('button', { name: 'Confirm this request' }).click()
    await expect(page).toHaveURL(/\/requests\/confirm\?done=1/)
    await expect(page.getByRole('heading', { name: 'Request confirmed' })).toBeVisible()

    expect(await confirmedAt(id)).toBe(firstTimestamp)
  })

  test('a syntactically-valid but nonexistent token renders the identical confirmation — no enumeration signal', async ({
    page,
  }) => {
    const bogusUuid = '00000000-0000-4000-8000-000000000000'
    await page.goto(`/requests/confirm?token=${bogusUuid}`)
    await page.getByRole('button', { name: 'Confirm this request' }).click()
    await expect(page).toHaveURL(/\/requests\/confirm\?done=1/)
    await expect(page.getByRole('heading', { name: 'Request confirmed' })).toBeVisible()
  })

  test('a garbage (non-uuid) token also renders the identical confirmation, never an error page', async ({ page }) => {
    await page.goto('/requests/confirm?token=not-a-uuid-at-all')
    await page.getByRole('button', { name: 'Confirm this request' }).click()
    await expect(page).toHaveURL(/\/requests\/confirm\?done=1/)
    await expect(page.getByRole('heading', { name: 'Request confirmed' })).toBeVisible()
  })

  test('no token at all still renders the page (the confirm form, not a crash)', async ({ page }) => {
    const response = await page.goto('/requests/confirm')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Confirm alerts for this request?' })).toBeVisible()
  })
})
