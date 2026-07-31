import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendEmail } from '@/lib/email'

/**
 * `lib/email.ts` is the one door out to Resend, and its three load-bearing properties
 * (never throws, never logs a recipient, returns false plainly when unconfigured) are
 * exactly the ones a live network call cannot prove on every CI run — so `fetch` is
 * stubbed here. This is the one module in the suite where that is the right call: every
 * other test file in this project talks to the real hosted Supabase (per the run-p4-admin
 * addendum), but Resend is a third-party HTTP boundary, not the system under test's own
 * database, and BT verified separately (see the BT report) that the real endpoint behaves
 * as this file assumes.
 *
 * BT finding, not fixed here (implementation is out of scope for this suite): as of this
 * run, `web/.env.local` actually has `RESEND_API_KEY` SET to a live-looking key — the
 * run dispatch's stated fact that it is "intentionally unset" does not hold in this
 * environment. That does not change what this module is supposed to do when the key is
 * ABSENT, which is what these tests pin; it changes what `sendMatchAlerts` actually does
 * against the live project right now (see the match-alerts integration coverage and the
 * BT report's findings section).
 */

const originalFetch = global.fetch

describe('sendEmail — no RESEND_API_KEY configured', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', '')
    global.fetch = vi.fn()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns false, warns, and never calls fetch — nothing is sent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const delivered = await sendEmail({
      to: 'someone@example.com',
      subject: 'Test',
      text: 'body',
    })
    expect(delivered).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    // The recipient address must never reach the log.
    expect(warn.mock.calls[0].join(' ')).not.toContain('someone@example.com')
  })

  it('never throws even if called with an empty recipient', async () => {
    await expect(
      sendEmail({ to: '', subject: '', text: '' })
    ).resolves.toBe(false)
  })
})

describe('sendEmail — RESEND_API_KEY configured', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 'test-key-not-real')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns true on a 2xx response and sends text-only, from the verified sender', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":"abc"}', { status: 200 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const delivered = await sendEmail({ to: 'buyer@example.com', subject: 'Hi', text: 'plain body' })
    expect(delivered).toBe(true)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({
      from: 'DaScout <no-reply@dascoutprime.com>',
      to: 'buyer@example.com',
      subject: 'Hi',
      text: 'plain body',
    })
    expect(body).not.toHaveProperty('html')
  })

  it('returns false and warns (without the response body) on a non-2xx response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('{"message":"someone@example.com is invalid"}', { status: 422 })) as unknown as typeof fetch

    const delivered = await sendEmail({ to: 'someone@example.com', subject: 'Hi', text: 'body' })
    expect(delivered).toBe(false)
    expect(warn).toHaveBeenCalled()
    const logged = warn.mock.calls.map((c) => c.join(' ')).join(' ')
    expect(logged).not.toContain('someone@example.com')
    expect(logged).toContain('422')
  })

  it('returns false and never throws when fetch itself rejects (network error)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch

    await expect(sendEmail({ to: 'x@example.com', subject: 'Hi', text: 'body' })).resolves.toBe(false)
    expect(warn).toHaveBeenCalled()
  })
})
