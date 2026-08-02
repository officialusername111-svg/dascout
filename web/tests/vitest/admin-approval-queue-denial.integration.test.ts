import { describe, it, expect, beforeAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { anonClient, staffClient, buyerClient, fakeUuid } from './helpers'

/**
 * ===========================================================================
 * run-p9 — THE THREE APPROVAL-QUEUE FUNCTIONS REFUSE EVERYBODY EXCEPT THE OWNER.
 *
 * STATUS: **PENDING MIGRATION APPLY, NOT BROKEN.**
 * `supabase/migrations/20260802204500_admin_invite_approval_queue.sql` is written
 * but NOT applied — the only Postgres this project can reach is PRODUCTION and
 * applying there is the owner's decision at an ASK gate. Until it is applied,
 * every test in this file reports FAILED with the message below, which names the
 * migration and says what to do. That is the intended state, and it is NOT a
 * defect in the code under test. Separate it from a genuine failure by reading
 * the message: a genuine failure is an assertion about a REFUSAL that did not
 * happen, and it is a Critical finding.
 * ===========================================================================
 *
 * WHY THIS FILE IS DENIAL-ONLY
 * ----------------------------
 * The happy path cannot be tested here and must not be attempted. Proving that
 * `approve_admin_invite` grants the role would mean creating an invitation, a
 * confirmed account and a real promotion **in the production database**, and then
 * leaving a person holding admin access or unpicking it by hand afterwards. The
 * suite has no super-admin credentials by design (`helpers.ts` offers `staff` and
 * `buyer` only), so the grant path is not reachable from here at all — which is
 * itself part of the safety argument. The happy path belongs to the owner's own
 * post-apply walkthrough, with the runbook's queries beside it.
 *
 * What IS testable, and is the property that matters most, is that the three
 * functions refuse every caller who is not a super admin. A passing run writes
 * NOTHING: every assertion expects a refusal, every argument is a uuid that
 * belongs to no invitation, and both other roles are refused before a row is
 * read. There is no zz- fixture here because there is nothing to fix up.
 *
 * WHAT "REFUSED" MUST LOOK LIKE — READ BEFORE CHANGING AN ASSERTION
 * ----------------------------------------------------------------
 * Two different layers can refuse, and both are correct:
 *
 *   * SQLSTATE **42501** — either the function's own `is_super_admin()` raise
 *     (`using errcode = 'insufficient_privilege'`) for a signed-in non-owner, or
 *     "permission denied for function" for a caller with no EXECUTE grant.
 *   * PostgREST **PGRST202** — for `anon` the function is not even in the exposed
 *     schema cache for that role.
 *
 * SILENCE IS A FAILURE. A `200` with data, or a `200` with a status string, means
 * a non-owner reached the body of a function that hands out email addresses or
 * grants a role. Every test below demands a real error object.
 *
 * WHY THE `beforeAll` THROWS INSTEAD OF SKIPPING
 * ----------------------------------------------
 * The same reason `admin-escalation-denial.integration.test.ts` gives: a security
 * test that goes green because the thing it tests is not installed yet
 * manufactures exactly the false assurance the run is trying to avoid. Before the
 * apply, every call here fails with PGRST202 — and an assertion written as "an
 * error came back" would PASS on a database where the function does not exist.
 * The gate makes that impossible. Do not convert it into a skip, a warning or a
 * `test.runIf`.
 */

const MIGRATION_ABSENT = [
  'MIGRATION NOT APPLIED — this suite cannot prove anything and is refusing to pass.',
  '',
  'public.list_admin_candidates() does not exist on the target project, so',
  '20260802204500_admin_invite_approval_queue.sql has not been applied. Until it is,',
  'every assertion below would pass for the wrong reason: a call to a function that',
  'is not there also comes back as an error.',
  '',
  'This is PENDING APPLY, not a defect. Apply the migration at the ASK gate, then:',
  '  npx vitest run tests/vitest/admin-approval-queue-denial.integration.test.ts',
].join('\n')

/** A uuid that belongs to no invitation. Every decision call below uses one. */
const NO_SUCH_INVITE = fakeUuid()

type AnyClient = SupabaseClient<Database>

/** The three functions are absent from the generated types until the apply. */
function callRpc(client: AnyClient, fn: string, args?: Record<string, unknown>) {
  return (
    client as unknown as {
      rpc(name: string, args?: Record<string, unknown>): PromiseLike<{
        data: unknown
        error: { code?: string | null; message: string } | null
      }>
    }
  ).rpc(fn, args)
}

let staff: AnyClient
let buyer: AnyClient
let anon: AnyClient

beforeAll(async () => {
  staff = await staffClient()
  buyer = await buyerClient()
  anon = anonClient()

  // The gate. A staff session may not call this function, but on a database where it
  // EXISTS the refusal is 42501; where it does not, PostgREST answers PGRST202.
  const { error } = await callRpc(staff, 'list_admin_candidates')
  if (error?.code === 'PGRST202') throw new Error(MIGRATION_ABSENT)
})

describe('list_admin_candidates — the queue hands out email addresses, so only the owner may read it', () => {
  it('a staff admin is refused, and gets no rows', async () => {
    const { data, error } = await callRpc(staff, 'list_admin_candidates')

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    expect(data).toBeNull()
  })

  it('a signed-in buyer is refused', async () => {
    const { data, error } = await callRpc(buyer, 'list_admin_candidates')

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    expect(data).toBeNull()
  })

  it('an anonymous caller is refused — the function is never granted to anon', async () => {
    const { data, error } = await callRpc(anon, 'list_admin_candidates')

    expect(error).not.toBeNull()
    expect(['42501', 'PGRST202']).toContain(error?.code)
    expect(data).toBeNull()
  })
})

describe('approve_admin_invite — the one door that grants a role', () => {
  it('a staff admin is refused before anything is read', async () => {
    const { data, error } = await callRpc(staff, 'approve_admin_invite', {
      invite_id: NO_SUCH_INVITE,
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    // Not 'not_found' — the refusal happens before the invitation is even looked up, so a
    // staff caller cannot use this endpoint to learn which invitation ids exist.
    expect(data).toBeNull()
  })

  it('a signed-in buyer is refused', async () => {
    const { data, error } = await callRpc(buyer, 'approve_admin_invite', {
      invite_id: NO_SUCH_INVITE,
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    expect(data).toBeNull()
  })

  it('an anonymous caller is refused', async () => {
    const { data, error } = await callRpc(anon, 'approve_admin_invite', {
      invite_id: NO_SUCH_INVITE,
    })

    expect(error).not.toBeNull()
    expect(['42501', 'PGRST202']).toContain(error?.code)
    expect(data).toBeNull()
  })
})

describe('decline_admin_invite — cancelling is a privileged act too', () => {
  it('a staff admin is refused', async () => {
    const { data, error } = await callRpc(staff, 'decline_admin_invite', {
      invite_id: NO_SUCH_INVITE,
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    expect(data).toBeNull()
  })

  it('a signed-in buyer is refused', async () => {
    const { data, error } = await callRpc(buyer, 'decline_admin_invite', {
      invite_id: NO_SUCH_INVITE,
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    expect(data).toBeNull()
  })

  it('an anonymous caller is refused', async () => {
    const { data, error } = await callRpc(anon, 'decline_admin_invite', {
      invite_id: NO_SUCH_INVITE,
    })

    expect(error).not.toBeNull()
    expect(['42501', 'PGRST202']).toContain(error?.code)
    expect(data).toBeNull()
  })
})

describe('the staff fixture is unchanged by any of this', () => {
  /**
   * A passing run of this file writes nothing at all. This is the proof of that claim,
   * and it also guards the hard rule that `test-staff-p4@dascout.local` keeps
   * `role = 'staff'`: if a refusal above ever silently succeeded, the account that made
   * the calls is the one that would have moved.
   */
  it('the staff account that made every refused call is still staff', async () => {
    const {
      data: { user },
    } = await staff.auth.getUser()
    expect(user).not.toBeNull()

    const { data: profile, error } = await staff
      .from('profiles')
      .select('role')
      .eq('id', user!.id)
      .maybeSingle()

    expect(error).toBeNull()
    expect(profile?.role).toBe('staff')
  })
})
