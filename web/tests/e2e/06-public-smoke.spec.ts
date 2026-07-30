import { test, expect } from '@playwright/test'
import { directClient } from './helpers'

/**
 * AC-32 — the 12 pre-existing (untouched) listings must still render exactly
 * as in Phase 2: home page cards, a live detail page, and sold rows with no
 * detail-page link. Read-only against the real data; never writes here.
 */
test.describe('Public site unchanged for live/sold (AC-32)', () => {
  test('home page renders at least the 12 pre-existing listings', async ({ page }) => {
    const anon = directClient()
    const { count } = await anon
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .in('status', ['live', 'sold'])
    expect(count).toBeGreaterThanOrEqual(12)

    await page.goto('/')
    const cards = page.locator('#listings .card, .grid .card')
    await expect(cards.first()).toBeVisible()
    const cardCount = await cards.count()
    expect(cardCount).toBeGreaterThan(0)
  })

  test('a live listing detail page returns 200', async ({ page }) => {
    const anon = directClient()
    const { data: live, error } = await anon.from('listings').select('slug').eq('status', 'live').limit(1).single()
    expect(error).toBeNull()

    const response = await page.goto(`/property/${live!.slug}`)
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1')).toBeVisible()
  })

  test('sold listings appear in "Just sold" without a detail-page link', async ({ page }) => {
    const anon = directClient()
    const { data: sold } = await anon.from('listings').select('slug, title').eq('status', 'sold').limit(1).maybeSingle()
    test.skip(!sold, 'No sold listings among the pre-existing 12 to assert against.')

    await page.goto('/')
    await page.getByRole('button', { name: 'Just sold' }).click()
    const row = page.locator('.rowitem', { hasText: sold!.title })
    await expect(row).toBeVisible()
    await expect(row.locator('a[href^="/property/"]')).toHaveCount(0)
  })
})
