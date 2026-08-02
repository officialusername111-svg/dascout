import { describe, it, expect, beforeAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { anonClient, staffClient, buyerClient, staffUserId } from './helpers'

/**
 * ===========================================================================
 * AC3 — A STAFF ADMIN CANNOT PROMOTE THEMSELVES OR ANYBODY ELSE.
 *
 * STATUS AT THE TIME OF WRITING (run-p6-admin-invites, 2026-08-02): **UNEXECUTED.**
 * `supabase/migrations/20260802021757_admin_invites_and_super_admin_split.sql` is
 * written but NOT applied — verified live the same day: `rpc('is_super_admin')`
 * answers PGRST202 ("Could not find the function") and `from('admin_invites')`
 * answers PGRST205. The only Postgres this project can reach is PRODUCTION and
 * applying there is a human ASK gate, so the escalation assertions below have
 * never been run. Nothing in this file may be cited as proof until it has.
 * ===========================================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The run brief's ground truth: `is_staff()` is true for BOTH `staff` and `admin`,
 * `profiles_staff_all` is `for all to authenticated using (is_staff())`, and the old
 * `guard_profile_role()` only asked `is_staff()`. So TODAY a signed-in `staff` user can
 * PATCH their own profiles row to `role = 'admin'` and become the owner tier. That is a
 * full privilege escalation, and closing it is the entire point of the migration.
 * "Closed" is not something a hidden nav link or a `requireSuperAdmin()` call can prove —
 * only the database can, which is why this file talks to PostgREST with a real staff
 * session and no application code anywhere in the loop. Same shape, same reasoning, as
 * `publish-guard-trigger.integration.test.ts`.
 *
 * WHY IT LIVES IN THE VITEST SUITE AND NOT IN `tests/e2e/01-auth-and-noindex.spec.ts`
 * ----------------------------------------------------------------------------------
 * The plan's surface map suggests the E2E authz spec as the home. That spec drives a
 * BROWSER through the app, which proves the UI refuses — and the UI refusing is exactly
 * what the non-negotiable says is NOT good enough ("enforced in the database, not just a
 * hidden UI control"). A direct authenticated PostgREST call is the only shape that can
 * fail for the right reason. The precedent for that shape is this suite, not Playwright.
 *
 * WHAT "DENIED" MUST LOOK LIKE — READ BEFORE CHANGING AN ASSERTION
 * ---------------------------------------------------------------
 * The migration defends the role column in three layers, and they do not fire in the
 * order a reader expects. GRANTS are checked before RLS and before any trigger, so the
 * expected answer to every promotion attempt below is the COLUMN GRANT firing:
 *
 *     SQLSTATE 42501, "permission denied for table profiles"
 *
 * If a runner ever sees the TRIGGER's wording instead — "only a super admin may set a
 * profile role" — the request got past the grant layer, which means
 * `revoke insert, update, delete on public.profiles from anon, authenticated` did not
 * take (or was re-granted by a later migration). The trigger caught it that time. It is
 * still a DEFECT and must be reported, not recorded as a pass: the run's whole design is
 * that the outermost layer holds, because the trigger is the layer a future migration can
 * most easily replace by accident. The assertions below therefore check the SQLSTATE and
 * separately name the trigger message as a wrong-layer failure.
 *
 * Silence is also a failure. PostgREST answers an UPDATE that RLS filtered to zero rows
 * with `200 []` and NO error. If a promotion attempt comes back clean-but-empty, the
 * grant did not fire either; every test here demands a real error object AND re-reads the
 * row to prove the role did not move.
 *
 * WHY THE `beforeAll` THROWS INSTEAD OF SKIPPING
 * ----------------------------------------------
 * Two reasons, and the second one is the important one.
 *
 * 1. A security test that goes green because the thing it tests is not installed yet is
 *    worse than no test at all — it manufactures the exact false assurance the run is
 *    trying to avoid. `describe.skipIf(...)` would do that. So the gate RAISES, every
 *    test in this file reports as failed, and the failure message says why in words.
 *
 * 2. **It is the safety interlock.** These tests attempt a real privilege escalation
 *    against the live project. Before the migration, that attempt SUCCEEDS — it would
 *    promote the `staff` fixture to `admin` in production and leave it there. Because
 *    vitest does not run an `it` body when its suite's `beforeAll` throws, the escalation
 *    is physically unreachable until the migration is in place. Do not convert this gate
 *    into a skip, a warning, or a `test.runIf`.
 *
 * CONSEQUENCE, STATED SO NOBODY IS SURPRISED: while the migration is unapplied,
 * `npx vitest run` is RED on this file by design. It goes green when the migration is
 * applied and the split actually works.
 *
 * BLAST RADIUS OF A FAILURE (what a red line here means for production data)
 * -------------------------------------------------------------------------
 * Every assertion expects a refusal, so a passing run writes nothing. If one FAILS, the
 * write it was trying to prevent has landed and must be undone by hand:
 *   - test 1 → `test-staff-p4@dascout.local` is now `admin`; set it back to `staff`.
 *   - test 2 → `test-buyer-p4@dascout.local` is now `admin`; set it back to `buyer`.
 *   - test 3 → a real `admin_invites` row exists for the zz- address; revoke it.
 *   - test 7 → the staff fixture's profiles row was deleted; recreate it as `staff`.
 * Each of those is a Critical finding in its own right.
 */

/** The one address any residue from this file can be recognised by (zz- protocol). */
const ZZ_INVITE_TARGET = 'zz-bt-escalation-probe@dascout.local'

/** The trigger's exact wording. Seeing this is a wrong-layer failure, not a pass. */
const TRIGGER_MESSAGE = 'only a super admin may set a profile role'

const MIGRATION_ABSENT = [
  'MIGRATION NOT APPLIED — this suite cannot prove anything and is refusing to pass.',
  '',
  'public.is_super_admin() does not exist on the target project, so',
  '20260802021757_admin_invites_and_super_admin_split.sql has not been applied.',
  'Until it is, a staff session CAN still promote itself to admin, and running the',
  'assertions below would perform that escalation against live data rather than',
  'observe it being refused.',
  '',
  'Apply the migration at the ASK gate, then re-run:',
  '  npx vitest run tests/vitest/admin-escalation-denial.integration.test.ts',
].join('\n')

/** PostgREST answers for "that function/table is not in the schema". */
const NOT_IN_SCHEMA = new Set(['PGRST202', 'PGRST203', 'PGRST205'])

const INSUFFICIENT_PRIVILEGE = '42501'

type Postgrestish = { code?: string | null; message?: string | null } | null

/**
 * `admin_invites` is deliberately absent from `lib/database.types.ts` — the hand-added
 * block there says so, because nothing in the APP selects the table this round. Only
 * these two probes do. Cast narrowly at the call site, exactly as `app/admin/actions.ts`
 * does for `reorder_listing_photos`, rather than widening the generated types for a test.
 * Delete this once the types are regenerated post-apply and the table appears.
 */
type UntypedTableReader = {
  from(relation: 'admin_invites'): {
    select(columns: string): PromiseLike<{ data: unknown[] | null; error: Postgrestish }>
  }
}

/**
 * One assertion in one place: the answer is a database refusal at the grant layer, it is
 * not silence, and it is not the trigger having to catch what the grant should have.
 */
function expectGrantLayerDenial(error: Postgrestish, what: string): void {
  expect(error, `${what}: expected a database refusal, got none — PostgREST answered cleanly, which means neither the column grant nor RLS refused the write`).not.toBeNull()

  expect(
    error?.message ?? '',
    `${what}: the TRIGGER refused this, not the column grant. The grant revocation on public.profiles did not take. Report as a defect — do not treat as a pass.`
  ).not.toContain(TRIGGER_MESSAGE)

  expect(error?.code, `${what}: expected SQLSTATE 42501 from the column grant`).toBe(
    INSUFFICIENT_PRIVILEGE
  )
  expect(error?.message ?? '').toContain('permission denied')
}

describe('AC3: a staff admin is refused every route to the admin role (database-enforced)', () => {
  let staff: SupabaseClient<Database>
  let anon: SupabaseClient<Database>
  let staffId: string
  let buyerId: string

  beforeAll(async () => {
    staff = await staffClient()
    anon = anonClient()
    staffId = await staffUserId(staff)

    // ---- the interlock. See the header. Raise, never skip. ----
    const probe = await staff.rpc('is_super_admin')
    if (probe.error && NOT_IN_SCHEMA.has(probe.error.code ?? '')) {
      throw new Error(MIGRATION_ABSENT)
    }
    if (probe.error) {
      throw new Error(
        `is_super_admin() exists but the staff fixture could not call it (${probe.error.code}: ${probe.error.message}). Expected a plain false. Investigate before trusting anything below.`
      )
    }

    // The fixture has to be the SUBJECT of the test, not an accidental super admin.
    expect(
      probe.data,
      'the TEST_STAFF fixture is a super admin — it cannot stand in for a staff admin. Check that test-staff-p4@dascout.local still has role=staff.'
    ).toBe(false)

    const buyer = await buyerClient()
    buyerId = await staffUserId(buyer)
    expect(buyerId, 'the buyer fixture must be a different account from the staff fixture').not.toBe(
      staffId
    )
  })

  // -------------------------------------------------------------------------
  // The headline: self-promotion. Two layers defend this one (grant + trigger);
  // RLS does not, because profiles_update_own legitimately permits your own row.
  // -------------------------------------------------------------------------

  it('cannot promote ITSELF to admin — the role column is not in any grant it holds', async () => {
    const { error } = await staff.from('profiles').update({ role: 'admin' }).eq('id', staffId)

    expectGrantLayerDenial(error, 'staff self-promotion')

    const { data } = await staff.from('profiles').select('role').eq('id', staffId).single()
    expect(data?.role, 'the staff fixture MOVED — this is a live privilege escalation').toBe('staff')
  })

  it('cannot promote ANOTHER account to admin — three layers, and the grant is the first', async () => {
    const { error } = await staff.from('profiles').update({ role: 'admin' }).eq('id', buyerId)

    expectGrantLayerDenial(error, 'staff promoting another user')

    const { data } = await staff.from('profiles').select('role').eq('id', buyerId).single()
    expect(data?.role, 'the buyer fixture was promoted — this is a live privilege escalation').toBe(
      'buyer'
    )
  })

  it('cannot promote itself to staff-by-another-name either: ANY role write is refused', async () => {
    // `buyer` is a demotion, not an escalation, and it still has to be refused — the
    // column grant is unconditional, so a "harmless" role write proves the grant is the
    // thing refusing rather than a predicate that happens to dislike 'admin'.
    const { error } = await staff.from('profiles').update({ role: 'buyer' }).eq('id', staffId)

    expectGrantLayerDenial(error, 'staff writing any role at all')

    const { data } = await staff.from('profiles').select('role').eq('id', staffId).single()
    expect(data?.role).toBe('staff')
  })

  it('CAN still write its own full_name — the split must not break the one grant it keeps', async () => {
    // The negative space of the test above. `grant update (full_name)` survives, so a
    // migration that over-revoked would show up here rather than as a support ticket.
    const { data: before } = await staff.from('profiles').select('full_name').eq('id', staffId).single()

    const { error } = await staff
      .from('profiles')
      .update({ full_name: before?.full_name ?? null })
      .eq('id', staffId)

    expect(error, 'staff lost the ability to write its own display name').toBeNull()
  })

  // -------------------------------------------------------------------------
  // The three super-admin doors. Each raises 42501 from inside the definer,
  // which is a different 42501 from the grant one above — hence a looser check.
  // -------------------------------------------------------------------------

  it('cannot call create_admin_invite — the invite door refuses a staff caller', async () => {
    const { data, error } = await staff.rpc('create_admin_invite', {
      invite_email: ZZ_INVITE_TARGET,
    })

    expect(error, 'create_admin_invite ACCEPTED a staff caller — an invite row now exists').not.toBeNull()
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE)
    expect(data ?? null, 'a token was minted for a caller who may not invite').toBeNull()
  })

  it('cannot call revoke_staff_admin — the demote door refuses a staff caller', async () => {
    const { error } = await staff.rpc('revoke_staff_admin', { target_id: buyerId })

    expect(error, 'revoke_staff_admin ACCEPTED a staff caller').not.toBeNull()
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE)
  })

  it('cannot call list_admin_accounts — the roster hands out real email addresses', async () => {
    const { data, error } = await staff.rpc('list_admin_accounts')

    expect(error, 'list_admin_accounts ACCEPTED a staff caller and returned admin emails').not.toBeNull()
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE)
    expect(data ?? null).toBeNull()
  })

  // -------------------------------------------------------------------------
  // The paths SA found that a trigger fix alone would not have closed.
  // -------------------------------------------------------------------------

  it('cannot DELETE its own profiles row — closing the delete-then-reinsert-as-admin path', async () => {
    // `profiles_staff_all` was FOR ALL while the old guard was BEFORE UPDATE only, so a
    // staff user could drop their row and insert a replacement carrying role='admin'.
    // The DELETE grant revocation is what closes it; the BEFORE INSERT arm of the trigger
    // is the backstop. If this line ever passes-through, the staff fixture's profile row
    // is GONE from production and has to be recreated by hand.
    const { error } = await staff.from('profiles').delete().eq('id', staffId)

    expect(error, 'staff DELETED its own profiles row — the delete grant was not revoked').not.toBeNull()
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE)

    const { data } = await staff.from('profiles').select('role').eq('id', staffId).single()
    expect(data?.role, 'the staff fixture row no longer reads back as staff').toBe('staff')
  })

  it('cannot INSERT a profiles row carrying a role — the insert grant is gone too', async () => {
    const { error } = await staff
      .from('profiles')
      .insert({ id: staffId, role: 'admin' })
      .select('id')

    expect(error, 'staff INSERTED into profiles — the insert grant was not revoked').not.toBeNull()
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE)
  })

  // -------------------------------------------------------------------------
  // The invite table and the redemption door, from the outside.
  // -------------------------------------------------------------------------

  it('cannot read admin_invites — the read policy is super-admin only', async () => {
    const { data, error } = await (staff as unknown as UntypedTableReader)
      .from('admin_invites')
      .select('id, email, status, expires_at')

    // RLS filtering to zero rows is the designed answer here (unlike the writes above,
    // where silence would mean the grant did not fire). Either shape is acceptable; rows
    // coming back are not.
    if (!error) {
      expect(data ?? [], 'a staff caller read invite rows').toEqual([])
    }
  })

  it('cannot read token_hash at all — the SELECT grant is column-scoped', async () => {
    // The column is excluded from the grant, so naming it is refused before RLS is even
    // consulted. This is what stops a future pending-invite screen putting a hash on the
    // wire by accident.
    const { error } = await (staff as unknown as UntypedTableReader)
      .from('admin_invites')
      .select('token_hash')

    expect(error, 'token_hash was selectable — the column-scoped grant did not take').not.toBeNull()
  })

  it('an ANONYMOUS caller cannot reach redeem_admin_invite at all', async () => {
    // Granted to `authenticated` only. Redemption is "I am already signed in as the person
    // who was invited", never "here is a token, make me an admin".
    const { data, error } = await anon.rpc('redeem_admin_invite', {
      raw_token: 'f'.repeat(64),
    })

    expect(error, 'anon reached the redemption RPC').not.toBeNull()
    expect(data ?? null).toBeNull()
  })

  /**
   * REWRITTEN (run-p9, 2026-08-02). This test used to read:
   *
   *   it('a STAFF caller presenting a token nobody issued is told only "invalid"', ...)
   *     const { data, error } = await staff.rpc('redeem_admin_invite', { raw_token: … })
   *     expect(error).toBeNull()
   *     expect(data).toBe('invalid')
   *     // and the role did not move
   *
   * It asserted that a signed-in caller REACHES the redemption function and receives one
   * uniform word, so the endpoint could not be used to find out which tokens exist. That
   * was the correct assertion while self-service redemption existed.
   *
   * The owner retired that door: `20260802204500_admin_invite_approval_queue.sql` §5
   * revokes EXECUTE from `authenticated`, so approval by the super admin is the only way
   * any account gets admin access. `error` is no longer null and `data` is no longer
   * 'invalid' — the old assertion now asserts something we intend to be false.
   *
   * The replacement is STRICTLY STRONGER on the property that survives, and I am not
   * claiming more than that: before, a staff caller ran the function body and was refused
   * by its own logic; now the call is refused by the EXECUTE grant before the body runs at
   * all. Enumeration is not merely uniform, it is unreachable. The role re-read is kept
   * verbatim, because "and it changed nothing" is the assertion that actually protects the
   * fixture account.
   *
   * PENDING APPLY: until the migration is applied this test FAILS, and the guard below
   * says so in words rather than as a confusing assertion diff. That is the same posture
   * as `admin-approval-queue-denial.integration.test.ts` and the same reason the suite
   * refuses to go green on something that is not installed.
   */
  it('a STAFF caller cannot reach redeem_admin_invite at all — the door is retired', async () => {
    const { data, error } = await staff.rpc('redeem_admin_invite', {
      raw_token: 'f'.repeat(64),
    })

    if (error === null && data === 'invalid') {
      throw new Error(
        [
          'THE RETIREMENT IS NOT IN FORCE. This means ONE of two things, and they are',
          'very different — check which before recording either:',
          '',
          '  (a) PENDING APPLY, not a defect. 20260802204500_admin_invite_approval_queue',
          '      .sql has not been applied yet, so nothing has revoked anything. Expected',
          '      before the ASK gate. Apply the migration and re-run this file.',
          '',
          '  (b) A DEFECT, if the migration HAS been applied. §5 revokes EXECUTE on',
          '      public.redeem_admin_invite(text) from `authenticated` — a staff session',
          '      reaching the function means that revoke did not take, or something',
          '      re-granted it. The self-service door is open. Report it.',
          '',
          'Tell them apart with:',
          "  select has_function_privilege('authenticated',",
          "    'public.redeem_admin_invite(text)', 'execute');",
          '  -- false = retired correctly; true = the grant is back.',
        ].join('\n')
      )
    }

    expect(error, 'a staff session reached the retired redemption door').not.toBeNull()
    expect(error?.code, 'expected the EXECUTE grant to refuse before the body runs').toBe(
      INSUFFICIENT_PRIVILEGE
    )
    expect(data ?? null).toBeNull()

    // And it changed nothing. Kept verbatim from the original.
    const { data: after } = await staff.from('profiles').select('role').eq('id', staffId).single()
    expect(after?.role).toBe('staff')
  })

  /**
   * THE NON-ENUMERATION PROPERTY, KEPT ALIVE ACROSS BOTH STATES OF THE DOOR.
   *
   * The test above asserts the door is shut. That is the stronger statement — but it is
   * stronger ONLY while the door stays shut, and §6 of the migration documents
   * un-retiring it as a single `grant execute` that is explicitly meant to be usable on
   * its own "if a live invitation ever has to be honoured the old way". Two live
   * invitations expire 2026-08-09, so that is a real sequence and not a hypothetical: the
   * grant comes back, the endpoint is public again, and the property that made it safe to
   * be public — every failure answers with the same word, so it cannot be used to find
   * out which tokens exist — would have had no test at all.
   *
   * So this one asserts whichever property is the live one, and neither branch can pass
   * vacuously:
   *
   *   * grant present  → every distinct failure path must answer BYTE-IDENTICALLY.
   *   * grant revoked  → the call must be refused at the grant layer, with no answer.
   *
   * WHAT IT DOES AND DOES NOT COVER, precisely. `redeem_admin_invite` has six semantic
   * failure reasons (no such token, expired, already accepted, revoked, wrong mailbox,
   * unconfirmed mailbox). Five of them need real invitation rows, and creating those in
   * production is not something a test may do — so they were never covered by the
   * original test either, which presented ONE junk token. What is covered here is every
   * failure path reachable without writing anything: the early length-bound return (empty,
   * short, over-long), the normalisation path (padded, upper-cased), and the hash-and-miss
   * path (well-formed but unissued, non-hex). Six inputs across three distinct branches of
   * the function, where the original had one. That is a wider sample of the same property,
   * not proof of all six reasons.
   *
   * It writes nothing in either state: every input is junk, and a junk token matches no
   * row, so the UPDATE inside the function touches zero rows.
   */
  it('redemption is either unreachable or uniformly refusing — never enumerable', async () => {
    const probes: { label: string; token: string }[] = [
      { label: 'well-formed but never issued', token: 'f'.repeat(64) },
      { label: 'at the 32-character lower bound', token: 'a'.repeat(32) },
      { label: 'empty — refused before any lookup', token: '' },
      { label: 'over the 256-character ceiling', token: 'b'.repeat(300) },
      { label: 'padded and upper-cased — the normalisation path', token: `  ${'C'.repeat(64)}  ` },
      { label: 'not hex at all', token: 'z'.repeat(64) },
    ]

    const answers: { label: string; data: unknown; code: string | null | undefined }[] = []

    for (const probe of probes) {
      const { data, error } = await staff.rpc('redeem_admin_invite', { raw_token: probe.token })
      answers.push({ label: probe.label, data, code: error?.code })
    }

    const reachable = answers.every((answer) => answer.code === undefined)

    if (reachable) {
      // The door is open (pre-apply, or re-granted). Uniformity is the property that
      // makes that safe, and it has to hold across every one of these paths.
      for (const answer of answers) {
        expect(
          answer.data,
          `${answer.label}: answered something other than the uniform refusal — this endpoint would tell an outsider which tokens exist`
        ).toBe('invalid')
      }

      // Not merely equal to the same expected value: literally one distinct answer between
      // them, so no future edit can let one path drift a word the others keep.
      expect(new Set(answers.map((answer) => JSON.stringify(answer.data))).size).toBe(1)
    } else {
      // The door is shut. Then it must be shut for ALL of them — a mixture would mean the
      // refusal depends on the input, which is an oracle of a different kind.
      for (const answer of answers) {
        expect(answer.code, `${answer.label}: expected the EXECUTE grant to refuse`).toBe(
          INSUFFICIENT_PRIVILEGE
        )
        expect(answer.data ?? null).toBeNull()
      }
    }

    // Either way, nothing moved.
    const { data: after } = await staff.from('profiles').select('role').eq('id', staffId).single()
    expect(after?.role).toBe('staff')
  })
})
