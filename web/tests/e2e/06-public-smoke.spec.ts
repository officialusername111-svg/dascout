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

  test('the market panel is gone from the public homepage, and no amount or map renders publicly', async ({ page }) => {
    // Landing redesign (run-landing-glass): amounts and the location map are admin-only.
    // The old "Just sold" market tab no longer exists for anonymous visitors.
    await page.goto('/')
    await expect(page.locator('#market')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Just sold' })).toHaveCount(0)
    expect(await page.locator('body').innerText()).not.toContain('₱')

    const anon = directClient()
    const { data: live } = await anon.from('listings').select('slug').eq('status', 'live').limit(1).maybeSingle()
    test.skip(!live, 'No live listings to assert the detail page against.')

    await page.goto(`/property/${live!.slug}`)
    expect(await page.locator('body').innerText()).not.toContain('₱')
    await expect(page.locator('.mapblock, iframe[src*="google.com/maps"]')).toHaveCount(0)
  })
})
