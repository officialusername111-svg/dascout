import { describe, it, expect } from 'vitest'
import { describeSignUpOutcome } from '@/app/account/actions'
import { SIGNUP_SENT } from '@/lib/account/messages'

/**
 * A.1/A.2 — `describeSignUpOutcome` is exported specifically because the property that
 * matters (existing-confirmed, existing-unconfirmed, rate-limited, and a genuine new
 * signup with confirmation email pending must all be byte-identical) cannot be observed
 * from outside the function: every one of them has to produce the exact same
 * `ActionResult` shape, or an outsider probing one address at a time learns something.
 *
 * No network call, no Supabase client, no `next/headers` — this is a pure function of
 * its two arguments, so it is tested directly with fixtures shaped like the real GoTrue
 * responses (per CONTRACT.md §4 A2 body / run-p3-accounts.md SL-14).
 */
describe('describeSignUpOutcome — SIGNUP_SENT uniformity (SL-5/SL-14)', () => {
  // A fabricated user with `identities: []` is exactly what GoTrue returns for an
  // existing, already-confirmed address — and the function must not even look.
  const existingConfirmedData = {
    user: { id: 'fake-id', identities: [] as unknown[] },
    session: null,
  }

  // An existing but unconfirmed address: GoTrue resends the confirmation and returns a
  // real user with no session, indistinguishable at this layer from a brand-new signup.
  const existingUnconfirmedData = {
    user: { id: 'real-id', identities: [{ id: 'x' }] },
    session: null,
  }

  // A brand-new address with email confirmation ON (F1): no session comes back either.
  const newSignupData = {
    user: { id: 'new-id', identities: [{ id: 'y' }] },
    session: null,
  }

  const rateLimitedError = { code: 'over_email_send_rate_limit', message: 'rate limited', status: 429 }

  it('existing-confirmed (identities: []), existing-unconfirmed, rate-limited, and new-signup are byte-identical', async () => {
    const outcomes = await Promise.all([
      describeSignUpOutcome(existingConfirmedData, null),
      describeSignUpOutcome(existingUnconfirmedData, null),
      describeSignUpOutcome(newSignupData, null),
      describeSignUpOutcome(null, rateLimitedError),
    ])

    const expected = { ok: true, message: SIGNUP_SENT }
    for (const outcome of outcomes) {
      expect(outcome).toEqual(expected)
    }

    // Not just equal to the same expected shape — literally identical to each other,
    // key-for-key, so no future edit can let one of them drift a field the others keep.
    const serialized = outcomes.map((o) => JSON.stringify(o))
    expect(new Set(serialized).size).toBe(1)
  })

  it('the per-address cooldown code (over_request_rate_limit on signup) is folded into the same uniform sentence', async () => {
    const outcome = await describeSignUpOutcome(null, {
      code: 'over_request_rate_limit',
      message: 'rate limited',
      status: 429,
    })
    expect(outcome).toEqual({ ok: true, message: SIGNUP_SENT })
  })

  it('a genuine session (confirmation OFF) is the one outcome that is allowed to differ', async () => {
    const outcome = await describeSignUpOutcome({ user: { id: 'x' }, session: { access_token: 't' } }, null)
    expect(outcome).toEqual({ signedIn: true })
  })

  it('email_address_invalid maps to a validation failure on the email field', async () => {
    const outcome = await describeSignUpOutcome(null, {
      code: 'email_address_invalid',
      message: 'invalid',
      status: 400,
    })
    expect(outcome).toMatchObject({
      ok: false,
      code: 'validation',
      fieldErrors: { email: expect.stringContaining('not accepted') },
    })
  })

  it('weak_password maps to a validation failure on the password field', async () => {
    const outcome = await describeSignUpOutcome(null, {
      code: 'weak_password',
      message: 'weak',
      status: 422,
    })
    expect(outcome).toMatchObject({
      ok: false,
      code: 'validation',
      fieldErrors: { password: expect.any(String) },
    })
  })

  it('validation_failed (Supabase\'s generic password rejection) also lands on the password field', async () => {
    const outcome = await describeSignUpOutcome(null, {
      code: 'validation_failed',
      message: 'bad',
      status: 422,
    })
    expect(outcome).toMatchObject({ ok: false, code: 'validation', fieldErrors: { password: expect.any(String) } })
  })

  it('an unmapped error code falls through to the generic unexpected failure, never a specific field', async () => {
    const outcome = await describeSignUpOutcome(null, { code: 'some_new_gotrue_code', status: 500 })
    expect(outcome).toMatchObject({ ok: false, code: 'unexpected' })
    expect('fieldErrors' in outcome ? outcome.fieldErrors : undefined).toBeUndefined()
  })
})
