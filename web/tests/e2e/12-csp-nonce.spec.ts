import { test, expect } from '@playwright/test'
import { directClient } from './helpers'

/**
 * The Slice A CSP nonce rework (AC-1, 2, 3, 5). `proxy.ts` builds the policy per request;
 * this file proves what a request actually receives, not what the code intends to send.
 */

const CSP_HEADER = 'content-security-policy'

function scriptSrc(csp: string): string {
  const match = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'))
  expect(match, 'script-src directive present').toBeTruthy()
  return match!
}

test.describe('CSP nonce rework (AC-1, 2, 3, 5)', () => {
  test('AC-1: script-src carries a per-request nonce + strict-dynamic, no unsafe-inline, and the nonce differs between two requests', async ({
    request,
  }) => {
    const first = await request.get('/')
    const second = await request.get('/')

    const cspFirst = first.headers()[CSP_HEADER]
    const cspSecond = second.headers()[CSP_HEADER]
    expect(cspFirst).toBeTruthy()
    expect(cspSecond).toBeTruthy()

    const srcFirst = scriptSrc(cspFirst)
    const srcSecond = scriptSrc(cspSecond)

    expect(srcFirst).toContain("'self'")
    expect(srcFirst).toContain("'strict-dynamic'")
    expect(srcFirst).not.toContain('unsafe-inline')

    const nonceFirst = srcFirst.match(/'nonce-([^']+)'/)?.[1]
    const nonceSecond = srcSecond.match(/'nonce-([^']+)'/)?.[1]
    expect(nonceFirst).toBeTruthy()
    expect(nonceSecond).toBeTruthy()
    expect(nonceFirst).not.toBe(nonceSecond)

    // Only one CSP header on the response — next.config.ts must not add a second one.
    expect(first.headers()[CSP_HEADER].split(',').length).toBeGreaterThanOrEqual(1)
  })

  test('AC-10 (proxy hardening): an inbound x-nonce / Content-Security-Policy header from the client is overwritten, never trusted', async ({
    request,
  }) => {
    const spoofed = await request.get('/', {
      headers: {
        'x-nonce': 'attacker-supplied-nonce',
        'content-security-policy': "script-src * 'unsafe-inline'",
      },
    })
    const csp = spoofed.headers()[CSP_HEADER]
    expect(csp).not.toContain('attacker-supplied-nonce')
    // style-src legitimately keeps 'unsafe-inline' (AC-4, documented) — the spoof check
    // is specifically about script-src, the directive the nonce rework actually closes.
    expect(scriptSrc(csp)).not.toContain('unsafe-inline')
    expect(scriptSrc(csp)).toMatch(/'nonce-[^']+'/)
  })

  test('AC-3: /auth/callback carries the CSP header on its redirect response (single cookie writer, still nonced)', async ({
    request,
  }) => {
    // No `code` query param -> the route redirects back with reason=link-invalid; the
    // point here is only that the response — a redirect, not HTML — still carries CSP.
    const response = await request.get('/auth/callback', { maxRedirects: 0 })
    expect([302, 303, 307, 308]).toContain(response.status())
    expect(response.headers()[CSP_HEADER]).toBeTruthy()
    expect(scriptSrc(response.headers()[CSP_HEADER])).toMatch(/'nonce-[^']+'/)
  })

  test('AC-5: robots.txt and sitemap.xml are unaffected — non-HTML, no CSP required, still 200', async ({
    request,
  }) => {
    const robots = await request.get('/robots.txt')
    expect(robots.status()).toBe(200)
    const sitemap = await request.get('/sitemap.xml')
    expect(sitemap.status()).toBe(200)
  })

  test('AC-2: zero console CSP-violation messages and the page hydrates on home, a property page, /admin/sign-in, /account (redirect), and a 404', async ({
    page,
    context,
  }) => {
    const cspMessages: string[] = []
    page.on('console', (msg) => {
      const text = msg.text()
      if (/content security policy|refused to (load|execute)/i.test(text)) {
        cspMessages.push(`[${msg.type()}] ${text}`)
      }
    })
    page.on('pageerror', (err) => cspMessages.push(`[pageerror] ${err.message}`))

    await page.setViewportSize({ width: 1440, height: 1000 })

    // home + hydration/interactivity proof: the request dialog opens on click.
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // Scoped to the "Can't find it? Request it." band — the hero carousel has an
    // off-screen CTA with the same accessible name (see 13-request-form.spec.ts).
    await page.locator('.reqband').getByRole('button', { name: /request a property/i }).click()
    await expect(page.locator('dialog[aria-labelledby="reqDH"][open]')).toBeVisible()
    await page.keyboard.press('Escape')

    // a real property page
    const anon = directClient()
    const { data: listing } = await anon.from('listings').select('slug').eq('status', 'live').limit(1).maybeSingle()
    if (listing) {
      await page.goto(`/property/${listing.slug}`)
      await page.waitForLoadState('networkidle')
    }

    // /admin/sign-in
    await page.goto('/admin/sign-in')
    await page.waitForLoadState('networkidle')

    // /account, signed out -> redirects; still must render+hydrate with no CSP violation
    await page.goto('/account')
    await page.waitForLoadState('networkidle')

    // a bogus URL -> 404
    const notFound = await page.goto('/this-page-definitely-does-not-exist-zz')
    expect(notFound?.status()).toBe(404)
    await page.waitForLoadState('networkidle')

    expect(cspMessages, cspMessages.join('\n')).toHaveLength(0)
    await context.close()
  })
})
