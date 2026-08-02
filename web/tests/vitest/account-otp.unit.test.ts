import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  OTP_CODE_LENGTH,
  OTP_CODE_PATTERN,
  OTP_CODE_REFUSED,
  OTP_CONFIRMED,
  OTP_FAILED,
  VerifyEmailCodeSchema,
  describeOtpOutcome,
  normaliseOtpCode,
} from '@/lib/account/otp'
import { RATE_LIMITED } from '@/lib/account/messages'

/**
 * run-p9 — the email confirmation CODE that replaces the confirmation link.
 *
 * Pure functions only: no network, no Supabase client, no `next/headers`. The action that
 * calls these (`verifyAccountEmailCode`) is a thin wrapper around them, which is the whole
 * reason they live in `lib/account/otp.ts`.
 *
 * Two properties are worth more than the rest:
 *
 * 1. **Every bad code says the same thing.** GoTrue answers a wrong code, an expired code,
 *    a spent code and a code for an address that has no account with the same
 *    `otp_expired`. If this mapper ever split them, the form would become a way to ask
 *    "does this address have an account?" one address at a time.
 * 2. **A response with no session is never reported as confirmed.** Telling somebody their
 *    address is confirmed when nothing here saw a session sends them to a sign-in that
 *    then refuses them.
 *
 * NOTE ON THE ENVIRONMENT: whether Supabase sends a code or a link is a DASHBOARD template
 * setting ("Confirm signup" → `{{ .Token }}` instead of `{{ .ConfirmationURL }}`) and the
 * owner has not made that change yet. Nothing here depends on it — these are functions of
 * their arguments — but no test in this file should be read as proof that a real code has
 * ever been sent.
 */

describe('normaliseOtpCode — six digits, however they were typed', () => {
  it('accepts a plain six-digit code', () => {
    expect(normaliseOtpCode('123456')).toBe('123456')
  })

  it('strips the spaces and hyphens people type when reading a code off a screen', () => {
    expect(normaliseOtpCode('123 456')).toBe('123456')
    expect(normaliseOtpCode('123-456')).toBe('123456')
    expect(normaliseOtpCode(' 1 2 3 4 5 6 ')).toBe('123456')
    expect(normaliseOtpCode('123456\n')).toBe('123456')
  })

  it('rejects five and seven digits — the boundaries either side', () => {
    expect(normaliseOtpCode('12345')).toBeNull()
    expect(normaliseOtpCode('1234567')).toBeNull()
  })

  it('rejects letters, an empty string, and anything that is not a string', () => {
    expect(normaliseOtpCode('12345a')).toBeNull()
    expect(normaliseOtpCode('abcdef')).toBeNull()
    expect(normaliseOtpCode('')).toBeNull()
    expect(normaliseOtpCode(null)).toBeNull()
    expect(normaliseOtpCode(undefined)).toBeNull()
    expect(normaliseOtpCode(123456)).toBeNull()
  })

  it('the declared length and the pattern agree with each other', () => {
    expect(OTP_CODE_LENGTH).toBe(6)
    expect(OTP_CODE_PATTERN.test('0'.repeat(OTP_CODE_LENGTH))).toBe(true)
    expect(OTP_CODE_PATTERN.test('0'.repeat(OTP_CODE_LENGTH + 1))).toBe(false)
  })
})

describe('VerifyEmailCodeSchema — an address and a code, both normalised first', () => {
  it("lower-cases and trims the address, and strips the code's separators", () => {
    const parsed = VerifyEmailCodeSchema.parse({
      email: '  Invitee@Example.COM ',
      code: '12 34-56',
    })
    expect(parsed).toEqual({ email: 'invitee@example.com', code: '123456' })
  })

  it('a malformed code fails on the code field with a sentence, not a regex', () => {
    const parsed = VerifyEmailCodeSchema.safeParse({ email: 'a@b.co', code: '12345' })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('unreachable')
    expect(parsed.error.issues[0].path[0]).toBe('code')
    expect(parsed.error.issues[0].message).toMatch(/6-digit/)
  })

  it('a malformed address fails on the email field, independently of the code', () => {
    const parsed = VerifyEmailCodeSchema.safeParse({ email: 'not-an-email', code: '123456' })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('unreachable')
    expect(parsed.error.issues.some((issue) => issue.path[0] === 'email')).toBe(true)
    expect(parsed.error.issues.some((issue) => issue.path[0] === 'code')).toBe(false)
  })

  it('a missing field is a failure rather than a default', () => {
    expect(VerifyEmailCodeSchema.safeParse({ email: 'a@b.co' }).success).toBe(false)
    expect(VerifyEmailCodeSchema.safeParse({ code: '123456' }).success).toBe(false)
  })
})

describe('describeOtpOutcome — one sentence for every bad code (no address oracle)', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  afterEach(() => {
    warn.mockClear()
  })

  it('a session and no error is the only confirmation', () => {
    expect(describeOtpOutcome(true, null)).toEqual({ confirmed: true })
  })

  it('otp_expired — wrong, expired, spent, or an address with no account — is one answer', () => {
    const outcome = describeOtpOutcome(false, { code: 'otp_expired', status: 403 })
    expect(outcome).toEqual({
      ok: false,
      code: 'validation',
      message: OTP_CODE_REFUSED,
      fieldErrors: { code: OTP_CODE_REFUSED },
    })
  })

  it('validation_failed lands on the same sentence — the code is all the person controls', () => {
    const a = describeOtpOutcome(false, { code: 'otp_expired', status: 403 })
    const b = describeOtpOutcome(false, { code: 'validation_failed', status: 422 })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('a rate limit says so honestly — it is per caller, not per address', () => {
    expect(describeOtpOutcome(false, { code: 'over_request_rate_limit', status: 429 })).toEqual({
      ok: false,
      code: 'conflict',
      message: RATE_LIMITED,
    })
  })

  it('an unmapped code is generic, logs the CODE only, and names no field', () => {
    const outcome = describeOtpOutcome(false, { code: 'some_new_gotrue_code', status: 500 })
    expect(outcome).toEqual({ ok: false, code: 'unexpected', message: OTP_FAILED })
    expect(warn).toHaveBeenCalledWith(
      '[account] unmapped otp error code:',
      'some_new_gotrue_code'
    )
  })

  /**
   * The one that must never regress: no error came back, but no session did either.
   * Nothing here knows whether the address is confirmed, so nothing here may say it is.
   */
  it('no error and no session is a failure, never a confirmation', () => {
    const outcome = describeOtpOutcome(false, null)
    expect(outcome).toEqual({ ok: false, code: 'unexpected', message: OTP_FAILED })
    expect('confirmed' in outcome).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('nothing the person typed is echoed into any outcome', () => {
    const outcomes = [
      describeOtpOutcome(true, null),
      describeOtpOutcome(false, { code: 'otp_expired', message: 'Token has expired or is invalid' }),
      describeOtpOutcome(false, { code: 'weird', message: 'invitee@example.com is bad' }),
    ]
    for (const outcome of outcomes) {
      const serialised = JSON.stringify(outcome)
      expect(serialised).not.toContain('123456')
      expect(serialised).not.toContain('invitee@example.com')
      // A GoTrue message is written for a server log, not for a screen.
      expect(serialised).not.toContain('Token has expired')
    }
  })

  it('the success sentence claims a confirmation and a session, and nothing more', () => {
    expect(OTP_CONFIRMED).toMatch(/confirmed/i)
    expect(OTP_CONFIRMED).not.toMatch(/admin/i)
  })
})
