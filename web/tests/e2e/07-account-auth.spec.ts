import { test, expect } from '@playwright/test'
import { signInViaModal, openAuthTab } from './helpers'

/**
 * B.5-8 + F.30 — the public sign-in/out journey through the real modal (never
 * `/admin/sign-in`), and the account/auth surfaces' noindex + no-store posture.
 */
test.describe('Public sign-in/out via the modal (B.5-8)', () => {
  test('B.5: wrong password gets the uniform sentence, no session cookie, and the same shape as a nonexistent email', async ({
    page,
  }) => {
    await openAuthTab(page, 'login')
    await page.locator('#li-user').fill(process.env.TEST_BUYER_EMAIL!)
    await page.locator('#li-pass').fill('definitely-the-wrong-password')
    await page.locator('dialog[open] button.mbtn[type="submit"]').click()
    await expect(page.locator('.field.invalid:has(#li-pass) .ferr')).toContainText('did not match an account')
    const wrongPasswordText = await page
      .locator('.field.invalid:has(#li-pass) .ferr')
      .textContent()

    const cookiesAfterWrongPassword = await page.context().cookies()
    expect(cookiesAfterWrongPassword.some((c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'))).toBe(
      false
    )

    // Fresh dialog, a completely different (nonexistent) address.
    await page.reload()
    await openAuthTab(page, 'login')
    await page.locator('#li-user').fill('zz-nonexistent-account-bt@dascout.local')
    await page.locator('#li-pass').fill('whatever-password-123')
    await page.locator('dialog[open] button.mbtn[type="submit"]').click()
    await expect(page.locator('.field.invalid:has(#li-pass) .ferr')).toBeVisible()
    const nonexistentText = await page.locator('.field.invalid:has(#li-pass) .ferr').textContent()

    expect(nonexistentText).toBe(wrongPasswordText)

    const cookiesAfterNonexistent = await page.context().cookies()
    expect(cookiesAfterNonexistent.some((c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'))).toBe(
      false
    )
  })

  test('B.6: correct sign-in via the modal sets a session cookie, closes the dialog, header shows the account entry', async ({
    page,
  }) => {
    await page.goto('/')
    await signInViaModal(page, 'buyer')

    // Dialog closed itself.
    await expect(page.locator('dialog[aria-labelledby="authH"][open]')).toHaveCount(0)

    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'))).toBe(true)

    // Header now shows one Account link, not Sign In / Create Account.
    await expect(page.locator('.hd-actions a.btn.btn-gold[href="/account"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign In' })).toHaveCount(0)
  })

  test('B.7: session persists across navigation; sign-out clears the cookie and the header reverts', async ({
    page,
  }) => {
    await page.goto('/')
    await signInViaModal(page, 'buyer')

    await page.goto('/#listings')
    await expect(page.locator('.hd-actions a.btn.btn-gold[href="/account"]')).toBeVisible()

    await page.goto('/account')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.waitForURL('**/')

    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'))).toBe(false)
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()
    await expect(page.locator('.hd-actions a.btn.btn-gold[href="/account"]')).toHaveCount(0)
  })

  test('B.8a: the staff fixture signs in through the PUBLIC modal with no eviction, and /admin still works', async ({
    page,
  }) => {
    await page.goto('/')
    await signInViaModal(page, 'staff')

    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'))).toBe(true)
    await expect(page.locator('.hd-actions a.btn.btn-gold[href="/account"]')).toBeVisible()

    const response = await page.goto('/admin')
    expect(response?.status()).toBeLessThan(400)
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { name: 'Listings' })).toBeVisible()
  })

  test('B.8b regression: the buyer fixture at /admin/sign-in (real credentials) is still evicted', async ({ page }) => {
    await page.goto('/admin/sign-in')
    await page.getByLabel('Email').fill(process.env.TEST_BUYER_EMAIL!)
    await page.getByLabel('Password').fill(process.env.TEST_BUYER_PASSWORD!)
    await page.getByRole('button', { name: /sign in/i }).click()

    // The admin door's own denial — signed in, then signed straight back out.
    await expect(page).toHaveURL(/\/admin\/sign-in/)
    await expect(page.locator('.fmsg.err[role="alert"]')).toContainText('need a staff account')
    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'))).toBe(false)
  })
})

test.describe('F.30: /account and /auth are unindexable and uncached', () => {
  test('/account (signed in) carries noindex + no-store', async ({ page }) => {
    await page.goto('/')
    await signInViaModal(page, 'buyer')
    const response = await page.goto('/account')
    expect(response?.headers()['x-robots-tag']).toContain('noindex')
    expect(response?.headers()['cache-control']).toContain('no-store')
  })

  test('/auth/callback carries no-store and noindex even on a synthetic bad request', async ({ page }) => {
    // `page.goto` follows the 303 transparently and would hand back the landing page's
    // headers instead of the callback route's own — fetch without following redirects
    // so this asserts the actual response `/auth/callback` sent.
    const response = await page.request.get('/auth/callback?code=garbage-code-bt-test', { maxRedirects: 0 })
    expect(response.status()).toBe(303)
    expect(response.headers()['cache-control']).toContain('no-store')
    // next.config.ts applies X-Robots-Tag to /auth/:path* regardless of what the route itself sets.
    expect(response.headers()['x-robots-tag']).toContain('noindex')
  })

  test('robots.txt disallows /account and /auth; sitemap carries no account/auth URL', async ({ request }) => {
    const robotsTxt = await request.get('/robots.txt')
    const robotsBody = await robotsTxt.text()
    expect(robotsBody).toMatch(/Disallow:\s*\/account/)
    expect(robotsBody).toMatch(/Disallow:\s*\/auth/)

    const sitemap = await request.get('/sitemap.xml')
    const sitemapBody = await sitemap.text()
    expect(sitemapBody).not.toContain('/account')
    expect(sitemapBody).not.toContain('/auth')
  })
})
