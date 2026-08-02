import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  APPROVAL_SUBJECT,
  APPROVE_ALREADY_ADMIN,
  APPROVE_AMBIGUOUS,
  APPROVE_DONE,
  APPROVE_DONE_UNSENT,
  APPROVE_EXPIRED,
  APPROVE_NOT_EMAILED,
  APPROVE_UNCONFIRMED,
  CANDIDATE_STATE_LABELS,
  DECISION_GONE,
  DECISION_STALE,
  DECISION_UNREADABLE,
  DECLINE_DONE,
  InviteDecisionSchema,
  approvalEmailBody,
  candidateDisplayName,
  candidateMetaLine,
  candidateState,
  classifyDecisionError,
  describeApproveOutcome,
  describeDeclineOutcome,
} from '@/lib/admin/invites'
import { approveAdminInvite, declineAdminInvite } from '@/app/admin/actions'
import { listAdminCandidates } from '@/lib/admin/queries'

/**
 * run-p9 — the pure half of the invite APPROVAL QUEUE, plus the two actions that call it.
 *
 * The feature's one non-negotiable is that NO AUTOMATIC PATH GRANTS A ROLE: an invited
 * address that reaches a confirmed account earns a place in a list the owner reads, and
 * nothing else. Two of the tests below are about exactly that — the actions send the
 * invitation's id and nothing that could name an account, and a caller who is not the
 * super admin never reaches the database at all.
 *
 * The rest is the mapping from a database status to a sentence, which has to be tested
 * directly because the property that matters is not observable from outside: seven
 * different situations must each produce their OWN sentence (the caller is the owner,
 * looking at their own list — there is nothing here to enumerate), and an answer nothing
 * recognises must NEVER read as a success.
 *
 * `supabase/migrations/20260802204500_admin_invite_approval_queue.sql` is written but NOT
 * applied, so nothing in this file touches a database. The RPC is stubbed; everything
 * under test is real.
 */

const mocked = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSuperAdmin: vi.fn(),
  requireSuperAdmin: vi.fn(),
  sendEmail: vi.fn(),
  /** What `from('admin_invites').select('email').eq(...).maybeSingle()` resolves to. */
  inviteRow: { data: null as { email: string } | null, error: null as unknown },
}))

/**
 * The client stub carries `from` as well as `rpc` because approving now re-reads the
 * approved address from the invitation row — from the DATABASE, never from the form — so
 * the notification cannot be aimed at an address the browser supplied.
 */
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: mocked.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => mocked.inviteRow,
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/email', () => ({ sendEmail: mocked.sendEmail }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

vi.mock('@/lib/admin/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/auth')>()
  return {
    ...actual,
    getSuperAdmin: mocked.getSuperAdmin,
    requireSuperAdmin: mocked.requireSuperAdmin,
  }
})

const INVITE_ID = '11111111-2222-4333-8444-555555555555'
const APPROVED_ADDRESS = 'zz-approved@dascout.local'

function formOf(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

describe('InviteDecisionSchema — one field, and it is an invitation id', () => {
  it('accepts a uuid', () => {
    expect(InviteDecisionSchema.safeParse({ inviteId: INVITE_ID }).success).toBe(true)
  })

  it('rejects anything that is not a uuid, with a sentence rather than a type name', () => {
    const parsed = InviteDecisionSchema.safeParse({ inviteId: 'not-a-uuid' })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('unreachable')
    expect(parsed.error.issues[0].message).toMatch(/could not be identified/i)
  })

  it('rejects a missing field rather than defaulting it', () => {
    expect(InviteDecisionSchema.safeParse({}).success).toBe(false)
    expect(InviteDecisionSchema.safeParse({ inviteId: null }).success).toBe(false)
  })

  /**
   * The structural half of "no automatic path grants a role": there is no field on this
   * schema that names an ACCOUNT. The database resolves the person from the invitation's
   * own address, so a doctored form cannot aim an approval at somebody else. If a
   * `profileId` ever appears here, that property is gone.
   */
  it('has exactly one key, and it is not an account id', () => {
    const parsed = InviteDecisionSchema.parse({ inviteId: INVITE_ID })
    expect(Object.keys(parsed)).toEqual(['inviteId'])
  })
})

// ---------------------------------------------------------------------------
// How a queue row reads
// ---------------------------------------------------------------------------

describe('candidateState — two states, derived from one fact', () => {
  it('a confirmed account is ready; no confirmed account is not signed up', () => {
    expect(candidateState(true)).toBe('ready')
    expect(candidateState(false)).toBe('not_signed_up')
  })

  it('both states have a label, and they are the ones on the approved sample', () => {
    expect(CANDIDATE_STATE_LABELS.ready).toBe('Ready')
    expect(CANDIDATE_STATE_LABELS.not_signed_up).toBe('Not signed up')
  })
})

describe('candidateDisplayName — the typo detector', () => {
  /**
   * The whole point of the fallback. The owner types an address; the row leads with the
   * NAME on the account that answered it. A stranger's name against an address the owner
   * meant to type differently is the one moment a mistyped invitation is catchable, and
   * it has to happen before the approval, not after it.
   */
  it('leads with the account holder’s own name when there is one', () => {
    expect(candidateDisplayName('Maria Santos', 'maria@example.com')).toBe('Maria Santos')
  })

  it('falls back to the invited address when there is no account or no name', () => {
    expect(candidateDisplayName(null, 'jose@example.com')).toBe('jose@example.com')
    expect(candidateDisplayName(undefined, 'jose@example.com')).toBe('jose@example.com')
  })

  it('treats a whitespace-only name as no name — signup metadata can carry one', () => {
    expect(candidateDisplayName('   ', 'jose@example.com')).toBe('jose@example.com')
    expect(candidateDisplayName('\t\n', 'jose@example.com')).toBe('jose@example.com')
  })

  it('trims a real name rather than rendering the padding', () => {
    expect(candidateDisplayName('  Maria Santos  ', 'm@example.com')).toBe('Maria Santos')
  })
})

describe('candidateMetaLine — the two states tell different stories', () => {
  it('a ready row says when they signed up and that the address is confirmed', () => {
    const line = candidateMetaLine('ready', {
      accountCreatedLabel: 'Aug 2, 2026, 6:14 PM',
      invitedLabel: 'Aug 2, 2026, 4:02 PM',
      expiresLabel: 'Aug 9, 2026, 4:02 PM',
    })
    expect(line).toBe(
      'Account created Aug 2, 2026, 6:14 PM · email confirmed · invitation expires Aug 9, 2026, 4:02 PM'
    )
  })

  it('a not-signed-up row says when it was sent and that nobody has an account', () => {
    const line = candidateMetaLine('not_signed_up', {
      accountCreatedLabel: null,
      invitedLabel: 'Aug 2, 2026, 4:02 PM',
      expiresLabel: 'Aug 9, 2026, 4:02 PM',
    })
    expect(line).toBe(
      'Invited Aug 2, 2026, 4:02 PM · no account created yet · invitation expires Aug 9, 2026, 4:02 PM'
    )
    // It must never claim a confirmation that has not happened.
    expect(line).not.toMatch(/confirmed/i)
  })

  it('drops missing labels instead of rendering "null" — a broken date still shows the row', () => {
    const line = candidateMetaLine('ready', {
      accountCreatedLabel: null,
      expiresLabel: null,
    })
    expect(line).toBe('email confirmed')
    expect(line).not.toMatch(/null|undefined/)
  })
})

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

describe('classifyDecisionError — 42501 is a refusal, everything else is a fault', () => {
  it('42501 is the one refusal both functions raise', () => {
    expect(classifyDecisionError('42501')).toBe('denied')
  })

  it('PGRST202 (the migration is not applied) is a FAULT, not a tidy sentence', () => {
    expect(classifyDecisionError('PGRST202')).toBe('unexpected')
  })

  it('a connection failure, a check violation, null and undefined are all faults', () => {
    expect(classifyDecisionError('08006')).toBe('unexpected')
    expect(classifyDecisionError('23514')).toBe('unexpected')
    expect(classifyDecisionError(null)).toBe('unexpected')
    expect(classifyDecisionError(undefined)).toBe('unexpected')
  })
})

// ---------------------------------------------------------------------------
// Approve — status → sentence
// ---------------------------------------------------------------------------

describe('describeApproveOutcome — seven answers, seven sentences', () => {
  it("'approved' is the only success", () => {
    const result = describeApproveOutcome('approved')
    expect(result).toEqual({ ok: true, message: APPROVE_DONE })
  })

  it("'not_found' is a not_found, not an error page", () => {
    expect(describeApproveOutcome('not_found')).toEqual({
      ok: false,
      code: 'not_found',
      message: DECISION_GONE,
    })
  })

  it("'not_pending' reads as somebody got there first", () => {
    expect(describeApproveOutcome('not_pending')).toEqual({
      ok: false,
      code: 'conflict',
      message: DECISION_STALE,
    })
  })

  it("'expired' says nothing was changed and what to do instead", () => {
    const result = describeApproveOutcome('expired')
    expect(result).toEqual({ ok: false, code: 'precondition', message: APPROVE_EXPIRED })
    expect(APPROVE_EXPIRED).toMatch(/nothing was changed/i)
  })

  it("'unconfirmed' says nothing was changed and that the row comes back", () => {
    const result = describeApproveOutcome('unconfirmed')
    expect(result).toEqual({ ok: false, code: 'precondition', message: APPROVE_UNCONFIRMED })
    expect(APPROVE_UNCONFIRMED).toMatch(/nothing was changed/i)
  })

  it("'ambiguous' is reported as unexpected — it is not a race a reload fixes", () => {
    expect(describeApproveOutcome('ambiguous')).toEqual({
      ok: false,
      code: 'unexpected',
      message: APPROVE_AMBIGUOUS,
    })
  })

  it("'already_admin' is a refusal, so the owner is never told an owner was demoted", () => {
    expect(describeApproveOutcome('already_admin')).toEqual({
      ok: false,
      code: 'conflict',
      message: APPROVE_ALREADY_ADMIN,
    })
  })

  /**
   * The one that matters most. If the database ever answers something this build does not
   * know — a value added by a later migration, a truncated response — claiming success
   * would tell the owner somebody has admin access when nothing here knows whether they
   * do. Every unknown must be a failure.
   */
  it('an unknown status, null and undefined all fail rather than claiming a grant', () => {
    for (const answer of ['something_new', '', null, undefined]) {
      const result = describeApproveOutcome(answer)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.message).toBe(DECISION_UNREADABLE)
    }
  })

  it('every failure sentence is distinct, so the screen never says two things at once', () => {
    const messages = [
      APPROVE_DONE,
      DECISION_GONE,
      DECISION_STALE,
      APPROVE_EXPIRED,
      APPROVE_UNCONFIRMED,
      APPROVE_AMBIGUOUS,
      APPROVE_ALREADY_ADMIN,
      DECISION_UNREADABLE,
    ]
    expect(new Set(messages).size).toBe(messages.length)
  })
})

// ---------------------------------------------------------------------------
// Decline — status → sentence
// ---------------------------------------------------------------------------

describe('describeDeclineOutcome — the cancel this product never had', () => {
  it("'declined' says plainly that nothing was granted", () => {
    expect(describeDeclineOutcome('declined')).toEqual({ ok: true, message: DECLINE_DONE })
    expect(DECLINE_DONE).toMatch(/nothing has been granted/i)
  })

  it("'not_pending' and 'not_found' reuse the two shared sentences", () => {
    expect(describeDeclineOutcome('not_pending')).toEqual({
      ok: false,
      code: 'conflict',
      message: DECISION_STALE,
    })
    expect(describeDeclineOutcome('not_found')).toEqual({
      ok: false,
      code: 'not_found',
      message: DECISION_GONE,
    })
  })

  it('an unknown status is a failure here too', () => {
    const result = describeDeclineOutcome('cancelled')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toBe(DECISION_UNREADABLE)
  })
})

// ---------------------------------------------------------------------------
// The actions
// ---------------------------------------------------------------------------

describe('approveAdminInvite / declineAdminInvite — the two doors', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  beforeEach(() => {
    mocked.rpc.mockReset().mockResolvedValue({ data: 'approved', error: null })
    mocked.sendEmail.mockReset().mockResolvedValue(true)
    mocked.inviteRow.data = { email: APPROVED_ADDRESS }
    mocked.getSuperAdmin.mockReset().mockResolvedValue({
      id: 'owner-id',
      email: 'owner@dascout.local',
      fullName: 'Owner',
      role: 'admin',
    })
    warn.mockClear()
  })

  afterEach(() => {
    warn.mockClear()
  })

  it('approve calls approve_admin_invite with the invitation id and NOTHING else', async () => {
    await approveAdminInvite(null, formOf({ inviteId: INVITE_ID }))

    expect(mocked.rpc).toHaveBeenCalledTimes(1)
    expect(mocked.rpc).toHaveBeenCalledWith('approve_admin_invite', { invite_id: INVITE_ID })
  })

  /**
   * A hand-written POST cannot smuggle a target. Anything else on the form is ignored,
   * because the action reads exactly one field and the database resolves the account from
   * the invitation's own address.
   */
  it('extra posted fields — a profile id, a role — are never forwarded', async () => {
    await approveAdminInvite(
      null,
      formOf({ inviteId: INVITE_ID, profileId: 'someone-else', role: 'admin' })
    )

    const [, args] = mocked.rpc.mock.calls[0]
    expect(args).toEqual({ invite_id: INVITE_ID })
  })

  it('decline calls decline_admin_invite with the same one argument', async () => {
    mocked.rpc.mockResolvedValue({ data: 'declined', error: null })

    const result = await declineAdminInvite(null, formOf({ inviteId: INVITE_ID }))

    expect(mocked.rpc).toHaveBeenCalledWith('decline_admin_invite', { invite_id: INVITE_ID })
    expect(result).toEqual({ ok: true, message: DECLINE_DONE })
  })

  it('a caller who is not the super admin never reaches the database, on either door', async () => {
    mocked.getSuperAdmin.mockResolvedValue(null)

    for (const action of [approveAdminInvite, declineAdminInvite]) {
      const result = await action(null, formOf({ inviteId: INVITE_ID }))
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.code).toBe('forbidden')
    }

    expect(mocked.rpc).not.toHaveBeenCalled()
  })

  it('a malformed invitation id never reaches the database either', async () => {
    for (const action of [approveAdminInvite, declineAdminInvite]) {
      const result = await action(null, formOf({ inviteId: 'nope' }))
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.code).toBe('validation')
    }

    expect(mocked.rpc).not.toHaveBeenCalled()
  })

  it("a 42501 from the database becomes the product's one denial sentence", async () => {
    mocked.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'only a super admin may approve an admin invitation' },
    })

    const result = await approveAdminInvite(null, formOf({ inviteId: INVITE_ID }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('forbidden')
    // The Postgres message names the function and its rule. Neither reaches a screen.
    expect(JSON.stringify(result)).not.toContain('only a super admin')
  })

  it('a fault throws to the global handler rather than becoming a friendly lie', async () => {
    mocked.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    })

    await expect(approveAdminInvite(null, formOf({ inviteId: INVITE_ID }))).rejects.toBeDefined()
    await expect(declineAdminInvite(null, formOf({ inviteId: INVITE_ID }))).rejects.toBeDefined()
  })

  it('an unreadable status comes back as a failure, not as a granted admin', async () => {
    mocked.rpc.mockResolvedValue({ data: 'who_knows', error: null })

    const result = await approveAdminInvite(null, formOf({ inviteId: INVITE_ID }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toBe(DECISION_UNREADABLE)
  })

  it('the invitation id is not echoed into the result of a refusal', async () => {
    mocked.rpc.mockResolvedValue({ data: 'not_found', error: null })

    const result = await approveAdminInvite(null, formOf({ inviteId: INVITE_ID }))

    expect(JSON.stringify(result)).not.toContain(INVITE_ID)
  })
})

// ---------------------------------------------------------------------------
// The queue read
// ---------------------------------------------------------------------------

describe('listAdminCandidates — both row states come from ONE read', () => {
  const OWNER = { id: 'owner-id', email: 'owner@dascout.local', fullName: 'Owner', role: 'admin' }

  const READY = {
    invite_id: '33333333-3333-4333-8333-333333333333',
    email: 'maria@example.com',
    full_name: 'Maria Santos',
    account_created_at: '2026-08-02T10:14:00.000Z',
    invited_at: '2026-08-02T09:00:00.000Z',
    invite_expires_at: '2026-08-09T09:00:00.000Z',
    has_confirmed_account: true,
  }

  const NOT_SIGNED_UP = {
    invite_id: '44444444-4444-4444-8444-444444444444',
    email: 'jose@example.com',
    full_name: null,
    account_created_at: null,
    invited_at: '2026-08-02T08:02:00.000Z',
    invite_expires_at: '2026-08-09T08:02:00.000Z',
    has_confirmed_account: false,
  }

  beforeEach(() => {
    mocked.requireSuperAdmin.mockReset().mockResolvedValue(OWNER)
    mocked.rpc.mockReset()
  })

  /**
   * The sourcing decision, asserted. The two states come back from the SAME function in
   * one snapshot, because the confirmed-account half of the predicate lives in
   * `auth.users` and no API caller can read it — computing the not-signed-up rows as a
   * set difference between two reads would be wrong the moment either read was stale.
   */
  it('maps ready and not-signed-up rows out of a single RPC call', async () => {
    mocked.rpc.mockResolvedValue({ data: [NOT_SIGNED_UP, READY], error: null })

    const queue = await listAdminCandidates()

    expect(mocked.rpc).toHaveBeenCalledTimes(1)
    expect(mocked.rpc).toHaveBeenCalledWith('list_admin_candidates')
    expect(queue.installed).toBe(true)
    if (!queue.installed) throw new Error('unreachable')

    // Ready first, whatever order the wire delivered.
    expect(queue.rows.map((row) => row.state)).toEqual(['ready', 'not_signed_up'])
    expect(queue.rows[0].displayName).toBe('Maria Santos')
    expect(queue.rows[0].canApprove).toBe(true)
    expect(queue.rows[1].displayName).toBe('jose@example.com')
    expect(queue.rows[1].canApprove).toBe(false)
    expect(queue.rows[1].metaLine).toMatch(/no account created yet/)
  })

  /**
   * The branch that keeps the Admins page alive between the deploy and the apply. It must
   * never come back as an empty queue: "nobody is waiting" and "the queue is not installed"
   * are different sentences, and only one of them is true here.
   */
  it('PGRST202 is reported as NOT INSTALLED, never as an empty queue', async () => {
    mocked.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    })

    const queue = await listAdminCandidates()

    expect(queue).toEqual({ installed: false })
    expect('rows' in queue).toBe(false)
  })

  it('any other error is a fault and throws', async () => {
    mocked.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    })

    await expect(listAdminCandidates()).rejects.toBeDefined()
  })

  it('an empty list is an installed queue with no rows — the two are never confused', async () => {
    mocked.rpc.mockResolvedValue({ data: [], error: null })

    const queue = await listAdminCandidates()

    expect(queue).toEqual({ installed: true, rows: [] })
  })
})

// ---------------------------------------------------------------------------
// The approval notification
// ---------------------------------------------------------------------------

describe('approveAdminInvite — the courtesy email cannot undo the grant', () => {
  beforeEach(() => {
    mocked.rpc.mockReset().mockResolvedValue({ data: 'approved', error: null })
    mocked.sendEmail.mockReset().mockResolvedValue(true)
    mocked.inviteRow.data = { email: APPROVED_ADDRESS }
    mocked.getSuperAdmin.mockReset().mockResolvedValue({
      id: 'owner-id',
      email: 'owner@dascout.local',
      fullName: 'Owner',
      role: 'admin',
    })
  })

  it('emails the address from the INVITATION ROW, never one the browser posted', async () => {
    await approveAdminInvite(
      null,
      formOf({ inviteId: INVITE_ID, email: 'attacker@example.com' })
    )

    expect(mocked.sendEmail).toHaveBeenCalledTimes(1)
    const sent = mocked.sendEmail.mock.calls[0][0] as { to: string; subject: string; text: string }
    expect(sent.to).toBe(APPROVED_ADDRESS)
    expect(sent.subject).toBe(APPROVAL_SUBJECT)
    expect(sent.text).toBe(approvalEmailBody())
  })

  it('sends only on a real approval — no other answer mails anybody', async () => {
    for (const answer of ['not_found', 'not_pending', 'expired', 'unconfirmed', 'ambiguous', 'already_admin']) {
      mocked.rpc.mockResolvedValue({ data: answer, error: null })
      await approveAdminInvite(null, formOf({ inviteId: INVITE_ID }))
    }

    expect(mocked.sendEmail).not.toHaveBeenCalled()
  })

  /**
   * The property this whole branch exists for. The role was written and committed inside
   * the database before the email was composed. A mail provider having a bad afternoon
   * must not be able to turn that into a failure on the screen, because an owner who is
   * told "that did not work" presses Approve again — and, worse, believes the person has
   * no access when they do.
   */
  it('a failed send is still a SUCCESS, with a warning that says who has to be told', async () => {
    mocked.sendEmail.mockResolvedValue(false)

    const result = await approveAdminInvite(null, formOf({ inviteId: INVITE_ID }))

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.message).toBe(APPROVE_DONE_UNSENT)
    expect(result.warning).toBe(APPROVE_NOT_EMAILED)
    // The successful sentence must not claim an email that did not go.
    expect(result.message).not.toMatch(/emailed them/i)
  })

  it('an invitation row that cannot be read is the same story — approved, nobody told', async () => {
    mocked.inviteRow.data = null

    const result = await approveAdminInvite(null, formOf({ inviteId: INVITE_ID }))

    expect(mocked.sendEmail).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.warning).toBe(APPROVE_NOT_EMAILED)
  })

  it('a delivered send says so, and carries no warning', async () => {
    const result = await approveAdminInvite(null, formOf({ inviteId: INVITE_ID }))

    expect(result).toEqual({ ok: true, message: APPROVE_DONE })
  })
})
