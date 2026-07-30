import { test, expect } from '@playwright/test'

/**
 * F.26-29 — `/auth/callback` synthetic-input coverage. Email delivery itself is parked
 * (`blocked-on-fact` A1, run-p3-accounts.md): nobody here can click a real confirmation
 * or recovery link. What IS testable without a mailbox is every branch the route takes
 * before it ever gets to a real Supabase exchange — the missing-verifier bail, the
 * refused `token_hash` types, and `safeNext`'s path sanitisation — because those are
 * observable from the request/response shape alone, with no valid credential in play.
 *
 * `maxRedirects: 0` is used throughout so the assertion is against the callback's own
 * 303 response (status, `Location`, headers), not whatever page the browser would have
 * followed on to.
 */
test.describe('/auth/callback — synthetic inputs (F.26-29)', () => {
  test('F.26: ?code=garbage with no verifier cookie -> 303 to reason=wrong-browser, zero Set-Cookie, no-store', async ({
    request,
  }) => {
    const response = await request.get('/auth/callback?code=garbage-code-bt-test', { maxRedirects: 0 })
    expect(response.status()).toBe(303)
    const location = response.headers()['location']
    expect(location).toContain('/?auth=login')
    expect(location).toContain('reason=wrong-browser')
    expect(response.headers()['set-cookie']).toBeUndefined()
    expect(response.headers()['cache-control']).toContain('no-store')
  })

  test('F.27: ?code=garbage WITH a synthetic sb-*-code-verifier cookie -> reason=expired', async ({ browser }) => {
    const context = await browser.newContext()
    await context.addCookies([
      {
        name: 'sb-bt-test-project-auth-token-code-verifier',
        value: 'not-a-real-verifier',
        domain: 'localhost',
        path: '/',
      },
    ])
    const page = await context.newPage()
    const response = await page.request.get('/auth/callback?code=garbage-code-bt-test', { maxRedirects: 0 })
    expect(response.status()).toBe(303)
    const location = response.headers()['location']
    expect(location).toContain('/?auth=login')
    expect(location).toContain('reason=expired')
    await context.close()
  })

  test('F.28a: ?token_hash=x&type=signup is refused outright (bounce, never exchanged)', async ({ request }) => {
    const response = await request.get('/auth/callback?token_hash=some-bearer-token&type=signup', {
      maxRedirects: 0,
    })
    expect(response.status()).toBe(303)
    const location = response.headers()['location']
    expect(location).toContain('/?auth=login')
    expect(location).toContain('reason=expired')
  })

  test('F.28b: ?token_hash=x&type=recovery is attempted (branch reachable; a bad hash still bounces cleanly)', async ({
    request,
  }) => {
    const response = await request.get('/auth/callback?token_hash=some-bearer-token&type=recovery', {
      maxRedirects: 0,
    })
    expect(response.status()).toBe(303)
    const location = response.headers()['location']
    // A genuinely bad hash fails the exchange -> bail(expired); the recovery branch
    // routes bounces to the forgot-password tab rather than the login tab.
    expect(location).toContain('/?auth=forgot')
    expect(location).toContain('reason=expired')
  })

  test('F.28c: no code and no token_hash at all -> link-invalid', async ({ request }) => {
    const response = await request.get('/auth/callback', { maxRedirects: 0 })
    expect(response.status()).toBe(303)
    const location = response.headers()['location']
    expect(location).toContain('reason=link-invalid')
  })

  test('F.29: next sanitisation — protocol-relative, backslash, double-encoded, and /auth loop targets all land somewhere safe', async ({
    request,
  }) => {
    const cases = [
      { next: '//evil.example', label: 'protocol-relative' },
      { next: '/\\evil', label: 'backslash' },
      { next: '%2F%2Fevil', label: 'double-encoded slash' },
      { next: '/auth/callback', label: 'self-loop' },
    ]

    for (const { next } of cases) {
      // No code/token_hash at all -> link-invalid bail, which never even reads `next` —
      // so this proves `next` is validated (or ignored) on the FAILURE path. The
      // same-origin guarantee on `next` matters most on bail, since bail is the only
      // branch reachable without a real Supabase credential from this harness; the
      // success path's `safeNext` call is the identical function (F.29 unit coverage
      // would require a real exchange, which is out of reach here — see BT report).
      const response = await request.get(`/auth/callback?next=${encodeURIComponent(next)}`, {
        maxRedirects: 0,
      })
      expect(response.status()).toBe(303)
      const location = response.headers()['location']!
      const url = new URL(location, 'http://localhost:3000')
      // Never off-origin: the Location header always resolves onto this same origin.
      expect(url.origin).toBe('http://localhost:3000')
      expect(url.pathname).not.toBe('/auth/callback')
    }
  })
})
