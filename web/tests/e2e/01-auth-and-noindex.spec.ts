import { test, expect } from '@playwright/test'
import { signInAsStaff, seedBuyerSessionCookie } from './helpers'

test.describe('Auth guard and admin unindexability (AC-1, 2, 3, 4a, 5, 6, 36)', () => {
  test('AC-1: staff sign-in sets a session and lands on /admin with the listing index', async ({ page }) => {
    await signInAsStaff(page)
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { name: 'Listings' })).toBeVisible()
    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'))).toBe(true)
  })

  test('AC-2: wrong password is rejected with a field error, no session, stays on sign-in', async ({ page }) => {
    await page.goto('/admin/sign-in')
    await page.getByLabel('Email').fill(process.env.TEST_STAFF_EMAIL!)
    await page.getByLabel('Password').fill('definitely-the-wrong-password')
    await page.getByRole('button', { name: /sign in/i }).click()

    await expect(page).toHaveURL(/\/admin\/sign-in/)
    await expect(page.locator('.fmsg.err[role="alert"]')).toContainText('did not match an account')
    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'))).toBe(false)
  })

  test('AC-3: signed-out /admin and /admin/listings/new redirect to sign-in, no admin markup', async ({ page }) => {
    const res1 = await page.goto('/admin')
    expect(res1?.status()).toBeLessThan(400)
    await expect(page).toHaveURL(/\/admin\/sign-in/)
    await expect(page.locator('.admin-bar')).toHaveCount(0)

    await page.goto('/admin/listings/new')
    await expect(page).toHaveURL(/\/admin\/sign-in/)
    await expect(page.locator('.admin-bar')).toHaveCount(0)
  })

  test('AC-5: session persists admin -> listing edit page without re-auth (independent auth.getUser() re-check)', async ({
    page,
  }) => {
    await signInAsStaff(page)
    // Any existing listing id works to prove the second page independently resolves
    // identity; the pre-existing seed data guarantees at least one row exists.
    const firstOpen = page.locator('a.btn.btn-dark.abtn-sm').first()
    await expect(firstOpen).toBeVisible()
    await firstOpen.click()
    await expect(page.locator('.admin-bar')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Status and publishing' })).toBeVisible()
  })

  test('AC-6: sign-out clears the session; a subsequent /admin request redirects to sign-in', async ({ page }) => {
    await signInAsStaff(page)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/admin\/sign-in/)

    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/sign-in/)
  })

  test('AC-4a: a signed-in buyer session gets no admin markup on GET /admin', async ({ page, context }) => {
    await seedBuyerSessionCookie(context)
    const response = await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/sign-in/)
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('.admin-bar')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Listings' })).toHaveCount(0)
  })

  test('AC-36: /admin carries noindex meta + X-Robots-Tag; robots.txt disallows /admin; sitemap has no admin URL', async ({
    page,
    request,
  }) => {
    const response = await page.goto('/admin/sign-in')
    expect(response?.headers()['x-robots-tag']).toContain('noindex')
    const robotsMeta = page.locator('meta[name="robots"]')
    await expect(robotsMeta).toHaveAttribute('content', /noindex/)

    const robotsTxt = await request.get('/robots.txt')
    const robotsBody = await robotsTxt.text()
    expect(robotsBody).toMatch(/Disallow:\s*\/admin/)

    const sitemap = await request.get('/sitemap.xml')
    const sitemapBody = await sitemap.text()
    expect(sitemapBody).not.toContain('/admin')
  })
})
