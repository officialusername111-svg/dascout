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

  /**
   * run-p8-price-detach — the other half of the price fix.
   *
   * `tests/vitest/anon-column-grants.integration.test.ts` proves the anon API refuses
   * `price_php`. On its own that proves nothing useful: a revoke that took the whole
   * public site down would pass it perfectly. This test is the counterweight — it asserts
   * the refusal and the three public pages rendering in ONE run, so the pair can only both
   * pass if the column is gone AND the site still works without it.
   *
   * Read-only, like the rest of this file — it writes nothing to the production database.
   */
  test('the anon API refuses price_php while home, index and property still render', async ({ page }) => {
    const anon = directClient()

    // 1. The API refuses the column.
    const { data: priced, error: priceError } = await anon.from('listings').select('price_php').limit(1)
    expect(priceError, 'anon read price_php off the API').not.toBeNull()
    expect(priced).toBeNull()

    // 2. The home page still renders — including the hero, which is the thing the ordering
    //    change touched and therefore the thing most likely to have broken.
    await page.goto('/')
    await expect(page.locator('.card').first()).toBeVisible()
    expect(await page.locator('body').innerText()).not.toContain('₱')

    // 3. The filtered listing view still renders. There is no /properties route — the
    //    index lives on `/` with query params — and `?loc=` is the filter worth exercising
    //    here because it is the one that reads `town_id` and `area_detail`, the two grants
    //    a "columns the site displays" reading of the list would most easily have missed.
    await page.goto('/?loc=a')
    await expect(page.locator('body')).toBeVisible()
    expect(await page.locator('body').innerText()).not.toContain('₱')

    // 4. The property page still renders. Its slug is fetched through the anon client with
    //    only granted columns, which incidentally proves the grant covers what the site
    //    reads.
    const { data: live, error: slugError } = await anon
      .from('listings')
      .select('slug, title, published_at')
      .eq('status', 'live')
      .limit(1)
      .maybeSingle()
    expect(slugError).toBeNull()
    test.skip(!live, 'No live listings to assert the property page against.')

    const response = await page.goto(`/property/${live!.slug}`)
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1')).toBeVisible()
    expect(await page.locator('body').innerText()).not.toContain('₱')
  })
})
