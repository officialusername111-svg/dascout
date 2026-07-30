import { describe, it, expect } from 'vitest'
import { signUpBuyer } from '@/app/account/actions'

/**
 * A.3/A.4/G.31 — the zod schemas backing `signUpBuyer` (`SignUpSchema`, `NewPasswordField`,
 * `FullNameField`) are private to `app/account/actions.ts` (CONTRACT.md §3 re-implements
 * them locally rather than exporting them), so they cannot be imported directly. But
 * `signUpBuyer` returns from `SignUpSchema.safeParse(...)` BEFORE it ever calls
 * `createClient()` — i.e. before it ever touches `next/headers` — whenever validation
 * fails. That makes the exported action itself testable here, in plain Node, as long as
 * every fixture is built to fail validation on at least one field.
 *
 * The trick used throughout this file: to prove a field's own boundary is *accepted*
 * without letting the whole submission succeed (which would reach `supabase.auth.signUp`
 * and touch the network), a DIFFERENT field is deliberately poisoned. `parsed.success`
 * stays false — so the action still returns before any Supabase call — but zod validates
 * every field independently, so the field under test either produces its own issue (and
 * therefore a `fieldErrors` entry) or it does not. Its absence from `fieldErrors` is the
 * proof that boundary passed.
 */

const VALID_EMAIL = 'zz-bt-account-tests@dascout.local'
const VALID_NAME = 'Zz Test Buyer'
const VALID_PASSWORD = 'CorrectHorse1'

function formOf(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

describe('signUpBuyer — password policy (A.3)', () => {
  it('a 7-character password is rejected with the 8-character message', async () => {
    const result = await signUpBuyer(null, formOf({
      email: VALID_EMAIL,
      fullName: VALID_NAME,
      password: '1234567', // 7 chars
    }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('validation')
    expect(result.fieldErrors?.password).toMatch(/at least 8 characters/i)
  })

  it('an 8-character password clears its own schema check (poisoned email forces the fail elsewhere)', async () => {
    const result = await signUpBuyer(null, formOf({
      email: 'not-an-email', // poisoned: fails at the email field, not the password
      fullName: VALID_NAME,
      password: '12345678', // exactly 8 chars — the accepted boundary
    }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('validation')
    expect(result.fieldErrors?.email).toBeDefined()
    expect(result.fieldErrors?.password).toBeUndefined()
  })

  it('a 73-character password is rejected (over the 72-char ceiling)', async () => {
    const result = await signUpBuyer(null, formOf({
      email: VALID_EMAIL,
      fullName: VALID_NAME,
      password: 'a'.repeat(73),
    }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fieldErrors?.password).toMatch(/72 characters or fewer/i)
  })
})

describe('signUpBuyer — full name policy (A.4)', () => {
  it('a blank full name is rejected', async () => {
    const result = await signUpBuyer(null, formOf({
      email: VALID_EMAIL,
      fullName: '',
      password: VALID_PASSWORD,
    }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fieldErrors?.fullName).toBeDefined()
  })

  it('a whitespace-only full name is rejected (blankToNull collapses it first)', async () => {
    const result = await signUpBuyer(null, formOf({
      email: VALID_EMAIL,
      fullName: '   ',
      password: VALID_PASSWORD,
    }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fieldErrors?.fullName).toBeDefined()
  })

  it('a full name containing a control character is rejected', async () => {
    const result = await signUpBuyer(null, formOf({
      email: VALID_EMAIL,
      fullName: 'JohnDoe',
      password: VALID_PASSWORD,
    }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fieldErrors?.fullName).toMatch(/cannot be used/i)
  })

  it('a full name of exactly 1 character is rejected (below the 2-char floor)', async () => {
    const result = await signUpBuyer(null, formOf({
      email: VALID_EMAIL,
      fullName: 'A',
      password: VALID_PASSWORD,
    }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fieldErrors?.fullName).toBeDefined()
  })

  it('a full name of exactly 2 characters clears its own check (poisoned password forces the fail elsewhere)', async () => {
    const result = await signUpBuyer(null, formOf({
      email: VALID_EMAIL,
      fullName: 'Jo', // exactly 2 chars — the accepted floor
      password: '123', // poisoned: too short, fails at the password field
    }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fieldErrors?.password).toBeDefined()
    expect(result.fieldErrors?.fullName).toBeUndefined()
  })

  it('a full name of exactly 80 characters clears its own check (poisoned password forces the fail elsewhere)', async () => {
    const result = await signUpBuyer(null, formOf({
      email: VALID_EMAIL,
      fullName: 'A'.repeat(80), // exactly 80 chars — the accepted ceiling
      password: '123', // poisoned
    }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fieldErrors?.fullName).toBeUndefined()
  })

  it('a full name of 81 characters is rejected (over the 80-char ceiling)', async () => {
    const result = await signUpBuyer(null, formOf({
      email: VALID_EMAIL,
      fullName: 'A'.repeat(81),
      password: VALID_PASSWORD,
    }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fieldErrors?.fullName).toBeDefined()
  })
})

describe('signUpBuyer — hygiene: password never in the returned values object (G.31)', () => {
  it('a validation failure never echoes back a "password" key, however the field was named on the wire', async () => {
    const result = await signUpBuyer(null, formOf({
      email: VALID_EMAIL,
      fullName: '', // forces a validation failure without any network call
      password: 'whatever-the-user-typed',
    }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.values).toBeDefined()
    expect(Object.keys(result.values ?? {})).not.toContain('password')
    expect(JSON.stringify(result.values)).not.toContain('whatever-the-user-typed')
  })

  it('the values object still carries email and fullName so the form can redraw them', async () => {
    const result = await signUpBuyer(null, formOf({
      email: VALID_EMAIL,
      fullName: '',
      password: 'irrelevant-here',
    }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.values?.email).toBe(VALID_EMAIL.toLowerCase())
  })
})
