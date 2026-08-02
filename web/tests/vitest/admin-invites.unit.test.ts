import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DemoteAdminSchema,
  INVITE_DUPLICATE,
  INVITE_LANDING_PATH,
  INVITE_NOT_EMAILED,
  INVITE_REFUSED,
  INVITE_SUBJECT,
  InviteAdminSchema,
  REVOKE_DONE,
  REVOKE_NO_CHANGE,
  classifyInviteError,
  classifyRevokeError,
  describeInviteSend,
  describeRevokeOutcome,
  inviteEmailBody,
  inviteLandingLink,
} from '@/lib/admin/invites'
import { isStaffRole, isSuperAdminRole } from '@/lib/admin/auth'
import { SITE_URL } from '@/lib/site'
import { inviteAdmin } from '@/app/admin/actions'
import { GET as inviteLandingGET } from '@/app/admin/invite/route'

/**
 * The three seams the ACTION tests below need stubbed, and nothing else.
 *
 * The point of these tests is the one property that cannot be checked by reading the
 * code once: that a real invitation token, present in the flow, never comes back out
 * through the value Next.js serialises into the RSC payload, through an email, or
 * through a log line. That demands the real `inviteAdmin`, which means standing in for
 * the request-scoped APIs it reaches for — the Supabase client, the mail door, and the
 * cache primitive. Everything under test stays real.
 *
 * The `next/headers` cookie stub went with the retired door (run-p9): nothing in this
 * flow reads or writes a cookie any more, so there is nothing left to stand in for.
 *
 * `@/lib/admin/auth` is mocked by SPREADING the real module and overriding one export, so
 * the `isStaffRole` / `isSuperAdminRole` tests further down still exercise the genuine
 * predicates.
 */

const mocked = vi.hoisted(() => ({
  rpc: vi.fn(),
  sendEmail: vi.fn(),
  getSuperAdmin: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: mocked.rpc }),
}))

vi.mock('@/lib/email', () => ({ sendEmail: mocked.sendEmail }))

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

/**
 * Shaped like the real thing: 32 bytes hex-encoded by `gen_random_bytes`. It is still
 * here because the landing-route tests below build an OLD invitation link out of it —
 * the kind already sitting in two mailboxes — to prove the handler drops it.
 *
 * `MIXED_HEX_TOKEN` went with the token-shape tests (see the block below): its only job
 * was to prove the validator accepted every hex digit, not just repeated 'a's.
 */
const REAL_SHAPE_TOKEN = 'a'.repeat(64)

/**
 * ===========================================================================
 * THE RETIRED SELF-SERVICE DOOR — what these tests replaced, and why.
 *
 * On 2026-08-02 the owner retired `redeem_admin_invite`: approval by the super
 * admin is now the ONLY way any account gets admin access. The token is no
 * longer emailed, the one-hop cookie that carried it is gone, and the page that
 * spent it no longer exists.
 *
 * THREE describe blocks used to stand here and they were deleted, not weakened,
 * because every function they exercised was deleted with the door:
 *
 *   * `isInviteTokenShape` (7 tests) — proved a malformed token never became a
 *     database round trip. There is no longer any code path that receives a
 *     token from outside, so there is nothing left to validate.
 *   * `normaliseInviteToken` (5 tests) — proved a mail client's padding or case
 *     shift was rescued rather than refused. Same reason.
 *   * `inviteCookieOptions` (7 tests) — proved the `ds-ai` cookie was httpOnly,
 *     lax, path-scoped, 15 minutes, and secure in production. There is no
 *     cookie: nothing sets one and nothing reads one.
 *
 * What replaces them is not a like-for-like swap and is not claimed to be one.
 * It is the set of invariants that the retirement CREATED, which are strictly
 * stronger than the ones it removed: those helpers made a token safe to handle,
 * whereas these prove no token is handled at all, by anything, anywhere.
 * ===========================================================================
 */

/**
 * Every `.ts`/`.tsx` file the application ships, so a claim about "nothing" can be checked.
 *
 * `proxy.ts` — Next 16's middleware — is included by the ROOT-LEVEL sweep and not by the
 * directory walk, and it is the reason that sweep exists. It runs on every single request
 * and already builds a Supabase server client, so it is the one module outside `app/`,
 * `lib/` and `components/` that could reach an RPC. An earlier version of this helper
 * walked only the three directories while the assertion below said "NO application
 * module", which was a claim wider than the evidence.
 */
function appSourceFiles(): string[] {
  const roots = ['app', 'lib', 'components']
  const found: string[] = []

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry)) found.push(path)
    }
  }

  for (const root of roots) walk(root)

  // Root-level modules: proxy.ts and the config files. Non-recursive, and `node_modules`
  // and `.next` are never reached because nothing walks into them from here.
  for (const entry of readdirSync('.')) {
    if (/\.tsx?$/.test(entry) && statSync(entry).isFile()) found.push(entry)
  }

  return found
}

describe('the retired self-service door — nothing can reach it any more (run-p9)', () => {
  const sources = appSourceFiles()

  it('finds the application source, so the three negative claims below mean something', () => {
    // The canary for this whole block: a broken walk would make every "no file
    // contains X" assertion pass by looking at nothing at all.
    expect(sources.length).toBeGreaterThan(40)
    expect(sources.some((path) => path.endsWith(join('lib', 'admin', 'invites.ts')))).toBe(true)
    expect(sources.some((path) => path.endsWith(join('app', 'admin', 'actions.ts')))).toBe(true)
    // Named on its own: it is the module that runs on every request, it builds a Supabase
    // client, and it lives outside all three walked directories.
    expect(sources).toContain('proxy.ts')
  })

  /**
   * The name is matched as a string literal in ANY of the three quote characters
   * TypeScript has — including backticks, which are idiomatic in this codebase and which
   * defeated the first version of this pattern — or as the PostgREST path a hand-rolled
   * `fetch` would use (`/rest/v1/rpc/name`).
   *
   * Matching backticks is only safe because the source is read through `codeOnly()`
   * first. Several files now explain the retirement in prose, and a markdown-style
   * `\`redeem_admin_invite\`` in a comment is character-for-character a template literal.
   * Stripping comments is what lets the pattern be wide without flagging documentation
   * the next reader needs — and it is deliberately conservative about which lines it
   * removes, so it cannot swallow a real call. `database.types.ts` still declares the
   * function as a bare object key, correctly: it exists in the database, it simply has no
   * EXECUTE grant, and a bare key is not a string literal.
   *
   * WHAT IT STILL CANNOT CATCH, stated rather than implied: a name assembled at runtime —
   * `'redeem_' + 'admin_invite'`, or a template with an interpolation in the middle. No
   * regex over source text can, and pretending otherwise would make this test read
   * stronger than it is. Those two cases are asserted below as known misses, so the limit
   * is a fact in the suite rather than a claim in a comment.
   *
   * **This is a guard, not the control.** The control is the database: §5 of the
   * migration revokes EXECUTE from `authenticated`, so a call assembled however cleverly
   * is refused anyway — and that revoke has its own test below.
   */
  const RPC_CALL = /(['"`])redeem_admin_invite\1|\/rpc\/redeem_admin_invite/
  const COOKIE_USE = /(['"`])ds-ai\1/

  /**
   * Source with COMMENTS removed: block comments in full, and whole lines that are a
   * `//` comment or a JSDoc `*` continuation.
   *
   * It deliberately does NOT strip a trailing `//` from the end of a code line. A naive
   * line-comment stripper cuts at the first `//`, which would silently eat the rest of
   * `fetch("https://…/rest/v1/rpc/redeem_admin_invite")` — turning the exact call shape
   * this test hunts for into a false negative. Erring toward keeping too much is the only
   * safe direction for a detector.
   */
  function codeOnly(text: string): string {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join('\n')
  }

  it('the detectors and the comment stripper both do what the claims below need', () => {
    // Negatives are worth what their detector is worth. These are the shapes a real call
    // takes, including the two that defeated the first version of this pattern.
    expect(RPC_CALL.test("await supabase.rpc('redeem_admin_invite', { raw_token: t })")).toBe(true)
    expect(RPC_CALL.test('rpc("redeem_admin_invite")')).toBe(true)
    expect(RPC_CALL.test('supabase.rpc(`redeem_admin_invite`, { raw_token: t })')).toBe(true)
    expect(RPC_CALL.test('fetch(url + "/rest/v1/rpc/redeem_admin_invite", init)')).toBe(true)
    expect(RPC_CALL.test("const FN = 'redeem_admin_invite'")).toBe(true)
    expect(COOKIE_USE.test("export const INVITE_COOKIE = 'ds-ai'")).toBe(true)
    expect(COOKIE_USE.test('jar.get(`ds-ai`)')).toBe(true)

    // A bare object key is a declaration, not a call.
    expect(RPC_CALL.test('redeem_admin_invite: { Args: { raw_token: string } }')).toBe(false)

    // The stripper removes prose in both comment shapes…
    const prose = [
      '/** `redeem_admin_invite` is retired — see §5. The `ds-ai` cookie went with it. */',
      '// `redeem_admin_invite` is retired',
      ' * and the `ds-ai` cookie with it',
      'const KEEP = 1',
    ].join('\n')
    expect(RPC_CALL.test(codeOnly(prose))).toBe(false)
    expect(COOKIE_USE.test(codeOnly(prose))).toBe(false)
    expect(codeOnly(prose)).toContain('const KEEP = 1')

    // …and does NOT eat a code line that merely contains a URL.
    const urlCall = 'await fetch("https://x.supabase.co/rest/v1/rpc/redeem_admin_invite")'
    expect(RPC_CALL.test(codeOnly(urlCall))).toBe(true)

    // Known misses, asserted so the limit cannot quietly become a false claim.
    expect(RPC_CALL.test("supabase.rpc('redeem_' + 'admin_invite')")).toBe(false)
    expect(RPC_CALL.test('supabase.rpc(`redeem_${x}admin_invite`)')).toBe(false)
  })

  it('NO application module calls redeem_admin_invite', () => {
    const callers = sources.filter((path) => RPC_CALL.test(codeOnly(readFileSync(path, 'utf8'))))
    expect(callers, `these files still call the retired RPC: ${callers.join(', ')}`).toEqual([])
  })

  it('NO application module still uses the ds-ai invite cookie', () => {
    const users = sources.filter((path) => COOKIE_USE.test(codeOnly(readFileSync(path, 'utf8'))))
    expect(users, `these files still use the retired cookie: ${users.join(', ')}`).toEqual([])
  })

  /**
   * The database layer is the one that actually holds. Everything above is "we
   * stopped calling it"; this is "nobody may call it", which is the statement a
   * hand-written PostgREST request runs into.
   */
  it('the migration revokes EXECUTE on redeem_admin_invite from authenticated', () => {
    const migration = readFileSync(
      join('..', 'supabase', 'migrations', '20260802204500_admin_invite_approval_queue.sql'),
      'utf8'
    )
    expect(migration).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.redeem_admin_invite\(text\)\s+from\s+authenticated;/i
    )
    // And the restoring grant is present only inside the commented rollback block,
    // so applying this file can never re-grant what it just took away.
    for (const line of migration.split('\n')) {
      if (/grant\s+execute\s+on\s+function\s+public\.redeem_admin_invite/i.test(line)) {
        expect(line.trimStart().startsWith('--')).toBe(true)
      }
    }
  })
})

describe('the invitation landing route — a redirect that carries nothing (run-p9)', () => {
  /**
   * This replaces what the old route-handler design needed the cookie for. The
   * handler survives only so that invitations already in a mailbox — some with
   * `?token=…` still on them — land somewhere useful instead of on a 404, and
   * the assertions below are that it forwards NONE of it.
   */
  async function landing(url: string) {
    return inviteLandingGET({ nextUrl: new URL(url) } as never)
  }

  it('redirects an old token-bearing link to the welcome page, with no query string', async () => {
    const response = await landing(`https://dascoutprime.com/admin/invite?token=${REAL_SHAPE_TOKEN}`)

    expect(response.status).toBe(303)
    const location = response.headers.get('location') ?? ''
    expect(location).toBe('https://dascoutprime.com/admin/invite/welcome')
    expect(location).not.toMatch(/[0-9a-f]{64}/)
    expect(new URL(location).search).toBe('')
  })

  it('sets no cookie at all — the token is not stored, it is dropped', async () => {
    const response = await landing(`https://dascoutprime.com/admin/invite?token=${REAL_SHAPE_TOKEN}`)

    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.cookies.getAll()).toEqual([])
  })

  it('still refuses to leak the old URL through a referrer or a shared cache', async () => {
    const response = await landing(`https://dascoutprime.com/admin/invite?token=${REAL_SHAPE_TOKEN}`)

    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('sends a bare link to exactly the same place', async () => {
    const response = await landing('https://dascoutprime.com/admin/invite')

    expect(response.headers.get('location')).toBe('https://dascoutprime.com/admin/invite/welcome')
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
  const link = inviteLandingLink()
  const body = inviteEmailBody({ link, expiresLabel: 'Aug 9, 2026, 5:17 PM' })

  /**
   * REWRITTEN (run-p9). This test used to read:
   *
   *   it('the link points at this site and carries the token exactly once', () => {
   *     expect(link.startsWith(`${SITE_URL}/admin/invite?token=`)).toBe(true)
   *     expect(body.split(REAL_SHAPE_TOKEN)).toHaveLength(2)
   *   })
   *
   * It asserted that the invitation link CARRIED the 256-bit redemption secret,
   * exactly once. The owner retired self-service redemption, so the secret now grants
   * nothing and has no business being in an email or in an access log — and the
   * assertion asserts something we intend to be false.
   *
   * The replacement keeps the first half verbatim (the link still points at this site
   * and nowhere else) and inverts the second into the stronger claim: the body carries
   * no token, no query string, and nothing that looks like a secret at all. `not.toMatch`
   * on the token pattern is wider than the old exact-count check — it fails on ANY
   * 64-hex string, not only on the one the test happened to build.
   */
  it('the link points at this site and carries no secret and no query string', () => {
    expect(link).toBe(`${SITE_URL}${INVITE_LANDING_PATH}`)
    expect(new URL(link).search).toBe('')
    expect(body).toContain(link)
    expect(body).not.toMatch(/[0-9a-f]{64}/)
    // Case-insensitive: `{{ .Token }}` and "Token" would both slip past `toContain`.
    expect(body).not.toMatch(/token/i)
  })

  /** The address is personal data and belongs in the envelope, never in the URL. */
  it('the link carries no email address either', () => {
    expect(link).not.toContain('@')
    expect(link).not.toMatch(/email=/i)
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

describe('inviteAdmin — a live token reaches NOTHING (SR-1, SR-2; run-p9)', () => {
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

  /**
   * REWRITTEN (run-p9). This test used to read:
   *
   *   it('puts the token in the email body — without this the rest of these tests
   *       prove nothing', async () => {
   *     await inviteAdmin(null, formOf({ email: INVITEE }))
   *     expect(mocked.sendEmail).toHaveBeenCalledTimes(1)
   *     const sent = mocked.sendEmail.mock.calls[0][0] as {...}
   *     expect(sent.to).toBe(INVITEE)
   *     expect(sent.text).toContain(LIVE_TOKEN)
   *   })
   *
   * Its job was twofold: prove the email carried the secret (the old flow's whole
   * mechanism), and act as the CANARY that made every negative assertion below it
   * meaningful — if no token were in the flow at all, "the result carries no token"
   * would pass trivially.
   *
   * The owner retired self-service redemption, so the first half is now something we
   * intend to be false. The canary half is not dropped, it is MOVED UP a level: the
   * stub still hands `inviteAdmin` a live token in the RPC response, and this test
   * asserts that it did — so the token is still provably in the flow — and then asserts
   * the email does not contain it. The negatives below therefore still mean what they
   * always meant, and the surface they cover grew from "everything except the email" to
   * "everything".
   */
  it('is handed a live token by the database and puts it in NOTHING — starting with the email', async () => {
    await inviteAdmin(null, formOf({ email: INVITEE }))

    // The canary: the token really was in this flow, on its way through the action.
    const rpcAnswer = await mocked.rpc.mock.results[0].value
    expect(rpcAnswer.data[0].invite_token).toBe(LIVE_TOKEN)

    expect(mocked.sendEmail).toHaveBeenCalledTimes(1)
    const sent = mocked.sendEmail.mock.calls[0][0] as { to: string; subject: string; text: string }
    expect(sent.to).toBe(INVITEE)
    expect(sent.text).not.toContain(LIVE_TOKEN)
    expect(sent.text).not.toMatch(/[0-9a-f]{64}/)
    // And what it sends instead is the landing page, with nothing on the URL.
    expect(sent.text).toContain(inviteLandingLink())
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

/**
 * ===========================================================================
 * DELETED WITH THE DOOR (run-p9): `describe('acceptAdminInvite — the token is
 * spent once and never written down (SR-2, SR-3)')`, eight tests.
 *
 * `web/app/admin/invite/actions.ts` no longer exists. The server action it
 * exported was the only caller of `redeem_admin_invite`, and the owner retired
 * that door: approval by the super admin is now the only way any account gets
 * admin access. There is nothing left to import, so these tests could not be
 * rewritten in place — they are listed here so the deletion is a record rather
 * than a gap. What each one proved, and where that property now lives:
 *
 *   1. accepted → cookie cleared, ?done=1, nothing logged ....... flow deleted
 *   2. the token is passed to the database as the cookie held it  flow deleted
 *   3. 'invalid' → ?failed=1, no token in URL or log ............ flow deleted
 *   4. an RPC error logs the CODE and nothing else .............. flow deleted
 *   5. the cookie is cleared even when the call throws .......... no cookie exists
 *   6. the clearing write is path-scoped ....................... no cookie exists
 *   7. no cookie → no database call ............................ no cookie exists
 *   8. a malformed cookie → no database call ................... no cookie exists
 *
 * Tests 1-4 were about handling a token safely on its way to a door that is now
 * shut; that door is proved shut, at the database, by 'the migration revokes
 * EXECUTE' above — which is the layer these eight never covered, because an
 * application test cannot. Tests 5-8 were about a cookie whose absence is now
 * asserted directly ('NO application module still uses the ds-ai invite cookie'
 * and 'sets no cookie at all'). Neither replacement is a like-for-like swap and
 * neither is offered as one.
 * ===========================================================================
 */
