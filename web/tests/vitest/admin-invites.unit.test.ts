import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DemoteAdminSchema,
  INVITE_COOKIE,
  INVITE_COOKIE_MAX_AGE,
  INVITE_COOKIE_PATH,
  INVITE_DUPLICATE,
  INVITE_NOT_EMAILED,
  INVITE_REFUSED,
  INVITE_SUBJECT,
  INVITE_TOKEN_PATTERN,
  InviteAdminSchema,
  REVOKE_DONE,
  REVOKE_NO_CHANGE,
  classifyInviteError,
  classifyRevokeError,
  describeInviteSend,
  describeRevokeOutcome,
  inviteCookieOptions,
  inviteEmailBody,
  inviteLinkFor,
  isInviteTokenShape,
  normaliseInviteToken,
} from '@/lib/admin/invites'
import { isStaffRole, isSuperAdminRole } from '@/lib/admin/auth'
import { SITE_URL } from '@/lib/site'
import { inviteAdmin } from '@/app/admin/actions'
import { acceptAdminInvite } from '@/app/admin/invite/actions'

/**
 * The four seams the two ACTION tests below need stubbed, and nothing else.
 *
 * The point of these tests is the one property that cannot be checked by reading the
 * code once: that a real invitation token, present in the flow, never comes back out
 * through the value Next.js serialises into the RSC payload or through a log line. That
 * demands the real `inviteAdmin` and the real `acceptAdminInvite`, which means standing
 * in for the request-scoped APIs they reach for — cookies, the Supabase client, the mail
 * door, and the cache/redirect primitives. Everything under test stays real.
 *
 * `@/lib/admin/auth` is mocked by SPREADING the real module and overriding one export, so
 * the `isStaffRole` / `isSuperAdminRole` tests further down still exercise the genuine
 * predicates.
 */

const mocked = vi.hoisted(() => ({
  rpc: vi.fn(),
  sendEmail: vi.fn(),
  getSuperAdmin: vi.fn(),
  /** Reassigned per test by `useJar`, so the cookies() mock always sees the live jar. */
  jar: null as unknown,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: mocked.rpc }),
}))

vi.mock('@/lib/email', () => ({ sendEmail: mocked.sendEmail }))

vi.mock('next/headers', () => ({ cookies: async () => mocked.jar }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    // `redirect()` works by throwing, and the action relies on that. The stub keeps the
    // behaviour and hangs the destination off the error so a test can read it.
    const signal = new Error(`NEXT_REDIRECT:${url}`) as Error & { redirectTo?: string }
    signal.redirectTo = url
    throw signal
  },
}))

vi.mock('@/lib/admin/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/auth')>()
  return { ...actual, getSuperAdmin: mocked.getSuperAdmin }
})

/**
 * Unit cover for the pure half of the admin-invite feature: token shape, cookie
 * attributes, the schemas, the email body, and every mapping from a database answer to
 * something a form renders.
 *
 * No network, no Supabase client, no `next/headers`. Everything under test is a function
 * of its arguments, which is exactly why it lives in `lib/admin/invites.ts` rather than
 * inside the `'use server'` module that calls it — the same split the account tests rely
 * on for `describeSignUpOutcome`.
 *
 * The migration this feature is built against is written but NOT applied, so nothing
 * here touches the database on purpose; the redemption, escalation-denial and RLS proofs
 * are integration work that runs after the apply.
 */

/** Shaped like the real thing: 32 bytes hex-encoded by `gen_random_bytes`. */
const REAL_SHAPE_TOKEN = 'a'.repeat(64)
const MIXED_HEX_TOKEN = '0123456789abcdef'.repeat(4)

describe('isInviteTokenShape — the token is 64 lowercase hex characters (SR-3)', () => {
  it('accepts a 64-character lowercase hex string', () => {
    expect(isInviteTokenShape(REAL_SHAPE_TOKEN)).toBe(true)
    expect(isInviteTokenShape(MIXED_HEX_TOKEN)).toBe(true)
    expect(MIXED_HEX_TOKEN).toHaveLength(64)
  })

  it('rejects 63 and 65 characters — the boundaries either side', () => {
    expect(isInviteTokenShape('a'.repeat(63))).toBe(false)
    expect(isInviteTokenShape('a'.repeat(65))).toBe(false)
  })

  it('rejects uppercase hex, because the database hex-encodes in lowercase', () => {
    expect(isInviteTokenShape('A'.repeat(64))).toBe(false)
  })

  it('rejects non-hex characters of the right length', () => {
    expect(isInviteTokenShape('g'.repeat(64))).toBe(false)
    expect(isInviteTokenShape(`${'a'.repeat(63)}-`)).toBe(false)
  })

  it('rejects surrounding whitespace rather than trimming it', () => {
    expect(isInviteTokenShape(` ${REAL_SHAPE_TOKEN}`)).toBe(false)
    expect(isInviteTokenShape(`${REAL_SHAPE_TOKEN}\n`)).toBe(false)
  })

  it('rejects everything that is not a string', () => {
    expect(isInviteTokenShape(null)).toBe(false)
    expect(isInviteTokenShape(undefined)).toBe(false)
    expect(isInviteTokenShape('')).toBe(false)
    expect(isInviteTokenShape(12345)).toBe(false)
    expect(isInviteTokenShape({ token: REAL_SHAPE_TOKEN })).toBe(false)
    expect(isInviteTokenShape([REAL_SHAPE_TOKEN])).toBe(false)
  })

  it('the pattern is anchored, so a valid token embedded in junk is still refused', () => {
    expect(INVITE_TOKEN_PATTERN.test(`x${REAL_SHAPE_TOKEN}`)).toBe(false)
    expect(INVITE_TOKEN_PATTERN.test(`${REAL_SHAPE_TOKEN}x`)).toBe(false)
  })
})

describe('normaliseInviteToken — the same rescue the database performs (SR-3)', () => {
  it('passes a already-clean token straight through', () => {
    expect(normaliseInviteToken(MIXED_HEX_TOKEN)).toBe(MIXED_HEX_TOKEN)
  })

  it('trims padding a mail client added around the link', () => {
    expect(normaliseInviteToken(`  ${MIXED_HEX_TOKEN}  `)).toBe(MIXED_HEX_TOKEN)
    expect(normaliseInviteToken(`\n${MIXED_HEX_TOKEN}\t`)).toBe(MIXED_HEX_TOKEN)
  })

  it('lower-cases a case-shifted token, which removes no entropy from lower-case hex', () => {
    expect(normaliseInviteToken(MIXED_HEX_TOKEN.toUpperCase())).toBe(MIXED_HEX_TOKEN)
  })

  it('refuses whitespace INSIDE the token — a token broken across a line is broken', () => {
    const split = `${MIXED_HEX_TOKEN.slice(0, 32)} ${MIXED_HEX_TOKEN.slice(32)}`
    expect(normaliseInviteToken(split)).toBeNull()
  })

  it('refuses anything that is not 64 hex characters after cleaning', () => {
    expect(normaliseInviteToken('a'.repeat(63))).toBeNull()
    expect(normaliseInviteToken('g'.repeat(64))).toBeNull()
    expect(normaliseInviteToken('')).toBeNull()
    expect(normaliseInviteToken(null)).toBeNull()
    expect(normaliseInviteToken(undefined)).toBeNull()
    expect(normaliseInviteToken(12345)).toBeNull()
  })
})

describe('inviteCookieOptions — the one-hop cookie (SR-3)', () => {
  const options = inviteCookieOptions()

  it('is httpOnly, so no script on the page can read the token out of it', () => {
    expect(options.httpOnly).toBe(true)
  })

  it('is lax, so it survives the arrival from a mail client but not a cross-site POST', () => {
    expect(options.sameSite).toBe('lax')
  })

  it('is scoped to the invite flow, not to the whole site', () => {
    expect(options.path).toBe(INVITE_COOKIE_PATH)
    expect(INVITE_COOKIE_PATH).toBe('/admin/invite')
    // The accept page sits underneath it, so the cookie reaches the page and the POST.
    expect('/admin/invite/accept'.startsWith(`${INVITE_COOKIE_PATH}/`)).toBe(true)
  })

  it('lives for fifteen minutes — long enough to read a page, short enough to be a window', () => {
    expect(options.maxAge).toBe(INVITE_COOKIE_MAX_AGE)
    expect(INVITE_COOKIE_MAX_AGE).toBe(900)
  })

  it('is named in the house style', () => {
    expect(INVITE_COOKIE).toMatch(/^ds-/)
  })

  it('is secure in production, so a 256-bit admin-granting secret never crosses plain HTTP', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(inviteCookieOptions().secure).toBe(true)
    vi.unstubAllEnvs()
  })

  it('drops secure outside production, matching rotateViewSession, so local http still works', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(inviteCookieOptions().secure).toBe(false)
    vi.unstubAllEnvs()
  })
})

describe('InviteAdminSchema — the address is normalised before it is stored (AC-2)', () => {
  it('trims and lower-cases, because the invite row carries check (email = lower(email))', () => {
    const parsed = InviteAdminSchema.safeParse({ email: '  Owner.Person@Example.COM ' })
    expect(parsed.success).toBe(true)
    if (!parsed.success) throw new Error('unreachable')
    expect(parsed.data.email).toBe('owner.person@example.com')
  })

  it('rejects a blank address', () => {
    expect(InviteAdminSchema.safeParse({ email: '' }).success).toBe(false)
    expect(InviteAdminSchema.safeParse({ email: '   ' }).success).toBe(false)
  })

  it('rejects something that is not an address at all', () => {
    const parsed = InviteAdminSchema.safeParse({ email: 'not-an-email' })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('unreachable')
    expect(parsed.error.issues[0].message).toMatch(/email address/i)
  })

  it('rejects a missing field rather than reading it as empty', () => {
    expect(InviteAdminSchema.safeParse({}).success).toBe(false)
    expect(InviteAdminSchema.safeParse({ email: null }).success).toBe(false)
  })
})

describe('DemoteAdminSchema — the target is a uuid or nothing (AC-7)', () => {
  it('accepts a uuid', () => {
    const parsed = DemoteAdminSchema.safeParse({
      profileId: '00000000-0000-4000-8000-000000000000',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects anything else, so Postgres never sees `uuid = \'abc\'`', () => {
    expect(DemoteAdminSchema.safeParse({ profileId: 'abc' }).success).toBe(false)
    expect(DemoteAdminSchema.safeParse({ profileId: '' }).success).toBe(false)
    expect(DemoteAdminSchema.safeParse({ profileId: null }).success).toBe(false)
  })
})

describe('classifyInviteError — decided by SQLSTATE, never by message (AC-2)', () => {
  it('42501 is a denial', () => {
    expect(classifyInviteError('42501')).toBe('denied')
  })

  it('23514 is a refusal — the function raises it for a bad address AND for the double-submit race', () => {
    expect(classifyInviteError('23514')).toBe('refused')
  })

  it('23505 is still mapped, so a raw unique violation can never arrive as a fault', () => {
    expect(classifyInviteError('23505')).toBe('duplicate')
  })

  it('anything unrecognised is a fault, not a guess', () => {
    expect(classifyInviteError('23503')).toBe('unexpected')
    expect(classifyInviteError('P0001')).toBe('unexpected')
    expect(classifyInviteError(null)).toBe('unexpected')
    expect(classifyInviteError(undefined)).toBe('unexpected')
    expect(classifyInviteError('')).toBe('unexpected')
  })
})

describe('classifyRevokeError', () => {
  it('42501 is a denial and everything else is a fault', () => {
    expect(classifyRevokeError('42501')).toBe('denied')
    expect(classifyRevokeError('23505')).toBe('unexpected')
    expect(classifyRevokeError(null)).toBe('unexpected')
  })
})

describe('describeInviteSend — a failed send is never reported as a success (SR-4)', () => {
  const values = { email: 'zz-invitee@dascout.local' }

  it('a delivered invitation is a success naming the address', () => {
    const result = describeInviteSend('zz-invitee@dascout.local', true, values)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.message).toContain('zz-invitee@dascout.local')
  })

  it('an undelivered invitation is a FAILURE, and says nobody received it', () => {
    const result = describeInviteSend('zz-invitee@dascout.local', false, values)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toBe(INVITE_NOT_EMAILED)
    expect(result.message).toMatch(/could not be sent/i)
    expect(result.message).toMatch(/nothing has been granted/i)
  })

  it('a failed send hands the address back so the form can redraw it', () => {
    const result = describeInviteSend('zz-invitee@dascout.local', false, values)
    if (result.ok) throw new Error('unreachable')
    expect(result.values?.email).toBe('zz-invitee@dascout.local')
  })

  it('carries back only the fields it was given, on either branch', () => {
    // NOT a security assertion: this function is never handed a token, so it could not
    // echo one whatever it did. It is a shape check — the result carries the message, the
    // ok flag and the values bag, and nothing invented. The real "no token in the RSC
    // payload" proof runs against `inviteAdmin` itself, at the bottom of this file.
    for (const delivered of [true, false]) {
      const result = describeInviteSend('zz-invitee@dascout.local', delivered, values)
      const keys = Object.keys(result).sort()
      expect(keys).toEqual(delivered ? ['message', 'ok'] : ['code', 'message', 'ok', 'values'])
    }
  })
})

describe('describeRevokeOutcome — revoked and no_change are different answers (AC-7)', () => {
  it("'revoked' is a success that says the account survives", () => {
    const result = describeRevokeOutcome('revoked')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.message).toBe(REVOKE_DONE)
    expect(result.message).toMatch(/buyer account/i)
  })

  it("'no_change' is a conflict asking for a reload, not a success", () => {
    const result = describeRevokeOutcome('no_change')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('conflict')
    expect(result.message).toBe(REVOKE_NO_CHANGE)
  })

  it('a null or unexpected answer is treated as no_change, never as success', () => {
    for (const answer of [null, undefined, '', 'something_else']) {
      expect(describeRevokeOutcome(answer).ok).toBe(false)
    }
  })
})

describe('the invitation email (SR-8)', () => {
  const link = inviteLinkFor(REAL_SHAPE_TOKEN)
  const body = inviteEmailBody({ link, expiresLabel: 'Aug 9, 2026, 5:17 PM' })

  it('the link points at this site and carries the token exactly once', () => {
    expect(link.startsWith(`${SITE_URL}/admin/invite?token=`)).toBe(true)
    expect(body.split(REAL_SHAPE_TOKEN)).toHaveLength(2)
  })

  it('names the SECOND email before it arrives, and says to open it first', () => {
    expect(body).toMatch(/SECOND email/)
    expect(body).toMatch(/Confirm your email/i)
    expect(body).toMatch(/open that link first|open that one first/i)
  })

  it('tells somebody who already has an account that there is no second email', () => {
    expect(body).toMatch(/no second email/i)
  })

  it('states the expiry it was given, and falls back to seven days without one', () => {
    expect(body).toContain('Aug 9, 2026, 5:17 PM')
    expect(inviteEmailBody({ link, expiresLabel: null })).toMatch(/seven days/)
  })

  it('carries no peso amount and no map — the standing rule, in email too', () => {
    expect(body).not.toContain('₱')
    expect(body).not.toMatch(/\bmaps?\b/i)
    expect(body).not.toMatch(/google\.com\/maps/i)
  })

  it('the subject is static, so nothing anybody typed reaches a subject line', () => {
    expect(INVITE_SUBJECT).toBe('You have been invited to the DaScout admin')
    expect(INVITE_SUBJECT).not.toMatch(/[0-9a-f]{64}/)
    expect(INVITE_SUBJECT).not.toContain('@')
  })

  it('contains nothing user-typed: no inviter name, no note, only a link and a date', () => {
    const other = inviteEmailBody({ link, expiresLabel: 'Aug 9, 2026, 5:17 PM' })
    // Two calls with the same arguments produce the same bytes — there is no third
    // input, so there is nowhere for somebody's typing to get in.
    expect(other).toBe(body)
  })
})

describe('refusal messages never echo a Postgres message (AC-2)', () => {
  it('the duplicate message says an invitation is already outstanding', () => {
    expect(INVITE_DUPLICATE).toMatch(/already outstanding/i)
  })

  it('the 23514 message covers both of its meanings and asks for one concrete action', () => {
    expect(INVITE_REFUSED).toMatch(/was not created/i)
    expect(INVITE_REFUSED).toMatch(/already be on its way/i)
    expect(INVITE_REFUSED).toMatch(/check the address/i)
  })

  it('no message names a table, a constraint, an index or an SQLSTATE', () => {
    for (const message of [INVITE_DUPLICATE, INVITE_REFUSED, INVITE_NOT_EMAILED, REVOKE_NO_CHANGE]) {
      expect(message).not.toMatch(/constraint|violat|admin_invites|_idx|pg_|SQLSTATE|235\d\d|42501/i)
    }
  })
})

describe('role predicates — the split is two predicates, not a narrowing (AC-1)', () => {
  it('isStaffRole still admits BOTH roles, so staff keep full listing access', () => {
    expect(isStaffRole('staff')).toBe(true)
    expect(isStaffRole('admin')).toBe(true)
    expect(isStaffRole('buyer')).toBe(false)
    expect(isStaffRole('broker')).toBe(false)
  })

  it('isSuperAdminRole admits only admin', () => {
    expect(isSuperAdminRole('admin')).toBe(true)
    expect(isSuperAdminRole('staff')).toBe(false)
    expect(isSuperAdminRole('buyer')).toBe(false)
    expect(isSuperAdminRole('broker')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The two properties that only the real actions can prove
// ---------------------------------------------------------------------------

/**
 * A token that is impossible to mistake for anything else, and still a legal one: 64
 * lowercase hex characters, exactly what `encode(gen_random_bytes(32), 'hex')` emits.
 */
const LIVE_TOKEN = 'deadbeef'.repeat(8)

const OWNER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'zz-owner@dascout.local',
  fullName: 'Zz Owner',
  role: 'admin' as const,
}

const INVITEE = 'zz-invitee@dascout.local'

function formOf(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

/** A cookie jar with the three methods the invite flow uses, and a record of every write. */
function makeJar(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  const writes: { name: string; value: string; options?: Record<string, unknown> }[] = []

  return {
    writes,
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
    has: (name: string) => store.has(name),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      writes.push({ name, value, options })
      if (options?.maxAge === 0) store.delete(name)
      else store.set(name, value)
    },
    delete: (name: string) => {
      writes.push({ name, value: '' })
      store.delete(name)
    },
    peek: (name: string) => store.get(name) ?? null,
  }
}

/**
 * Everything written to the console during one test, flattened into one string.
 *
 * Errors are unwrapped to `name: message` rather than JSON-stringified, because
 * `JSON.stringify(new Error(x))` is `{}` — which would hide exactly the regression this
 * is watching for, somebody adding `console.error(err, token)` while debugging.
 */
function captureConsole() {
  const lines: unknown[] = []
  const record = (...args: unknown[]) => lines.push(...args)
  const spies = [
    vi.spyOn(console, 'warn').mockImplementation(record),
    vi.spyOn(console, 'error').mockImplementation(record),
    vi.spyOn(console, 'log').mockImplementation(record),
    vi.spyOn(console, 'info').mockImplementation(record),
  ]

  return {
    restore: () => spies.forEach((spy) => spy.mockRestore()),
    text: () =>
      lines
        .map((line) => {
          if (typeof line === 'string') return line
          if (line instanceof Error) return `${line.name}: ${line.message}`
          try {
            return JSON.stringify(line)
          } catch {
            return String(line)
          }
        })
        .join(' | '),
  }
}

/** Runs something that is expected to `redirect()`, and returns where it went. */
async function captureRedirect(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    const target = (error as { redirectTo?: string }).redirectTo
    if (typeof target === 'string') return target
    throw error
  }
  throw new Error('expected a redirect, and none happened')
}

describe('inviteAdmin — a live token reaches the email and nothing else (SR-1, SR-2)', () => {
  let logs: ReturnType<typeof captureConsole>

  beforeEach(() => {
    logs = captureConsole()
    mocked.getSuperAdmin.mockReset().mockResolvedValue(OWNER)
    mocked.sendEmail.mockReset().mockResolvedValue(true)
    mocked.rpc.mockReset().mockResolvedValue({
      data: [
        {
          invite_id: '22222222-2222-4222-8222-222222222222',
          invite_token: LIVE_TOKEN,
          invite_expires_at: '2026-08-09T09:17:00.000Z',
        },
      ],
      error: null,
    })
  })

  afterEach(() => {
    logs.restore()
  })

  it('puts the token in the email body — without this the rest of these tests prove nothing', async () => {
    await inviteAdmin(null, formOf({ email: INVITEE }))

    expect(mocked.sendEmail).toHaveBeenCalledTimes(1)
    const sent = mocked.sendEmail.mock.calls[0][0] as { to: string; subject: string; text: string }
    expect(sent.to).toBe(INVITEE)
    expect(sent.text).toContain(LIVE_TOKEN)
    // The token is in the flow. Every assertion below is therefore a real one.
  })

  it('the leak detector fires on a result that DOES carry a token — the canary', () => {
    // The other assertions in this block are all negatives, and a negative assertion is
    // only worth what its detector is worth. This is that detector, run against exactly
    // the regression it exists to catch: an ActionResult that grew a token field.
    const leaking = { ok: true as const, message: 'Invitation sent.', data: { token: LIVE_TOKEN } }
    const serialised = JSON.stringify(leaking)

    expect(serialised).toContain(LIVE_TOKEN)
    expect(serialised).toMatch(/[0-9a-f]{64}/)

    // And on the log detector, for the same reason.
    const noisy = captureConsole()
    console.error(new Error('boom'), LIVE_TOKEN)
    const captured = noisy.text()
    noisy.restore()
    expect(captured).toContain(LIVE_TOKEN)
    expect(captured).toMatch(/[0-9a-f]{64}/)
  })

  it('the DELIVERED result carries no token — nothing token-shaped reaches the RSC payload', async () => {
    mocked.sendEmail.mockResolvedValue(true)

    const result = await inviteAdmin(null, formOf({ email: INVITEE }))
    const serialised = JSON.stringify(result)

    expect(result.ok).toBe(true)
    expect(serialised).not.toContain(LIVE_TOKEN)
    expect(serialised).not.toMatch(/[0-9a-f]{64}/)
  })

  it('the NOT-DELIVERED result carries no token either', async () => {
    mocked.sendEmail.mockResolvedValue(false)

    const result = await inviteAdmin(null, formOf({ email: INVITEE }))
    const serialised = JSON.stringify(result)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toBe(INVITE_NOT_EMAILED)
    // This is the branch a future debugging session is most likely to grow a field on.
    expect(serialised).not.toContain(LIVE_TOKEN)
    expect(serialised).not.toMatch(/[0-9a-f]{64}/)
    expect(JSON.stringify(result.values)).not.toContain(LIVE_TOKEN)
  })

  it('nothing reaches the console on either branch', async () => {
    for (const delivered of [true, false]) {
      mocked.sendEmail.mockResolvedValue(delivered)
      await inviteAdmin(null, formOf({ email: INVITEE }))
    }

    expect(logs.text()).not.toContain(LIVE_TOKEN)
    expect(logs.text()).not.toMatch(/[0-9a-f]{64}/)
  })

  it('a database refusal is mapped without the token or a Postgres message reaching anything', async () => {
    mocked.rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'a valid email address is required' } })

    const result = await inviteAdmin(null, formOf({ email: INVITEE }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toBe(INVITE_REFUSED)
    expect(JSON.stringify(result)).not.toMatch(/[0-9a-f]{64}/)
    expect(JSON.stringify(result)).not.toContain('a valid email address is required')
    expect(logs.text()).not.toMatch(/[0-9a-f]{64}/)
  })

  it('a FAULT thrown out of the action carries no token, and logs none on the way out', async () => {
    mocked.rpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'connection failure' } })

    await expect(inviteAdmin(null, formOf({ email: INVITEE }))).rejects.toBeDefined()
    expect(mocked.sendEmail).not.toHaveBeenCalled()
    expect(logs.text()).not.toMatch(/[0-9a-f]{64}/)
  })

  it('an empty return from the function is a fault, not a success, and names no token', async () => {
    mocked.rpc.mockResolvedValue({ data: [], error: null })

    await expect(inviteAdmin(null, formOf({ email: INVITEE }))).rejects.toThrow(
      /create_admin_invite returned no row/
    )
    expect(mocked.sendEmail).not.toHaveBeenCalled()
  })

  it('a caller who is not the super admin never reaches the database or the mail door', async () => {
    mocked.getSuperAdmin.mockResolvedValue(null)

    const result = await inviteAdmin(null, formOf({ email: INVITEE }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('forbidden')
    expect(mocked.rpc).not.toHaveBeenCalled()
    expect(mocked.sendEmail).not.toHaveBeenCalled()
  })

  it('an address that fails validation never reaches the database either', async () => {
    const result = await inviteAdmin(null, formOf({ email: 'not-an-email' }))

    expect(result.ok).toBe(false)
    expect(mocked.rpc).not.toHaveBeenCalled()
    expect(mocked.sendEmail).not.toHaveBeenCalled()
  })
})

describe('acceptAdminInvite — the token is spent once and never written down (SR-2, SR-3)', () => {
  let logs: ReturnType<typeof captureConsole>
  let jar: ReturnType<typeof makeJar>

  function useJar(cookies: Record<string, string> = {}) {
    jar = makeJar(cookies)
    mocked.jar = jar
    return jar
  }

  beforeEach(() => {
    logs = captureConsole()
    mocked.rpc.mockReset().mockResolvedValue({ data: 'accepted', error: null })
    useJar({ [INVITE_COOKIE]: LIVE_TOKEN })
  })

  afterEach(() => {
    logs.restore()
  })

  it('an accepted redemption clears the cookie, lands on ?done=1, and logs nothing', async () => {
    const target = await captureRedirect(() => acceptAdminInvite())

    expect(target).toBe('/admin/invite/accept?done=1')
    expect(jar.peek(INVITE_COOKIE)).toBeNull()
    expect(target).not.toMatch(/[0-9a-f]{64}/)
    expect(logs.text()).not.toContain(LIVE_TOKEN)
  })

  it('the token is passed to the database exactly as the cookie held it', async () => {
    await captureRedirect(() => acceptAdminInvite())

    expect(mocked.rpc).toHaveBeenCalledWith('redeem_admin_invite', { raw_token: LIVE_TOKEN })
    // Same guard as the invite tests: the token really was in this flow.
  })

  it("an 'invalid' answer lands on ?failed=1 with no token in the URL and none in the log", async () => {
    mocked.rpc.mockResolvedValue({ data: 'invalid', error: null })

    const target = await captureRedirect(() => acceptAdminInvite())

    expect(target).toBe('/admin/invite/accept?failed=1')
    expect(target).not.toMatch(/[0-9a-f]{64}/)
    expect(logs.text()).not.toMatch(/[0-9a-f]{64}/)
  })

  it('an RPC error logs the CODE and nothing else — not the token, not the address', async () => {
    mocked.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for function redeem_admin_invite' } })

    const target = await captureRedirect(() => acceptAdminInvite())

    expect(target).toBe('/admin/invite/accept?failed=1')
    expect(logs.text()).toContain('42501')
    expect(logs.text()).not.toContain(LIVE_TOKEN)
    expect(logs.text()).not.toMatch(/[0-9a-f]{64}/)
    expect(logs.text()).not.toContain(INVITEE)
  })

  it('the cookie is gone even when the call throws — single use starts before anything can fail', async () => {
    mocked.rpc.mockRejectedValue(new Error('the database went away'))

    await expect(acceptAdminInvite()).rejects.toThrow(/database went away/)
    expect(jar.peek(INVITE_COOKIE)).toBeNull()
    expect(jar.writes.some((write) => write.name === INVITE_COOKIE && write.options?.maxAge === 0)).toBe(true)
    expect(logs.text()).not.toMatch(/[0-9a-f]{64}/)
  })

  it('the clearing write is path-scoped, or it would clear a different cookie and leave the real one', async () => {
    await captureRedirect(() => acceptAdminInvite())

    const clear = jar.writes.find((write) => write.options?.maxAge === 0)
    expect(clear).toBeDefined()
    expect(clear?.name).toBe(INVITE_COOKIE)
    expect(clear?.value).toBe('')
    expect(clear?.options?.path).toBe(INVITE_COOKIE_PATH)
    expect(clear?.options?.httpOnly).toBe(true)
  })

  it('no cookie at all means no database call, and the same ?failed=1 page', async () => {
    useJar()

    const target = await captureRedirect(() => acceptAdminInvite())

    expect(target).toBe('/admin/invite/accept?failed=1')
    expect(mocked.rpc).not.toHaveBeenCalled()
  })

  it('a malformed cookie value is refused before it becomes a database round trip', async () => {
    useJar({ [INVITE_COOKIE]: 'not-a-token' })

    const target = await captureRedirect(() => acceptAdminInvite())

    expect(target).toBe('/admin/invite/accept?failed=1')
    expect(mocked.rpc).not.toHaveBeenCalled()
  })
})
