import { describe, it, expect } from 'vitest'
import {
  APPROVAL_SUBJECT,
  CONFIRM_SIGNUP_TEMPLATE,
  approvalEmailBody,
  inviteEmailBody,
  inviteLandingLink,
} from '@/lib/admin/invites'
import { SIGNUP_SENT } from '@/lib/account/messages'
import { SITE_URL } from '@/lib/site'

/**
 * run-p9 — the three emails of the invitation flow, held to the things they must say.
 *
 * They are tested as pure functions because that is what they are: no client, no network,
 * no `next/headers`. The property that matters is not "does it read nicely" — it is that
 * each one tells the person the ONE thing that stops them writing to the owner:
 *
 *   invitation  → there is a code coming, and after it a PERSON has to approve you.
 *   approval    → there is nothing to do; the access is already on your account.
 *   confirm     → the code, and where it fits in the flow.
 *
 * The existing invitation-email assertions live in `admin-invites.unit.test.ts` and still
 * hold (the second email, the expiry, no peso amount, nothing user-typed). These are the
 * ones the rewrite added.
 */

const LINK = inviteLandingLink()
const INVITE = inviteEmailBody({ link: LINK, expiresLabel: 'Aug 9, 2026, 5:17 PM' })
const APPROVAL = approvalEmailBody()

describe('the invitation email — rewritten for the approval queue', () => {
  /**
   * The sentence the rewrite exists for. The old copy ended "come back and press Accept
   * invitation", which is not what finishes an invitation any more.
   */
  it('promises no acceptance step, and names the owner approving as what finishes it', () => {
    expect(INVITE).not.toMatch(/press\s+"?Accept invitation"?/i)
    expect(INVITE).toMatch(/owner approves your account/i)
  })

  it('says plainly that approval is a person and may take a while', () => {
    expect(INVITE).toMatch(/a person, not a machine/i)
    expect(INVITE).toMatch(/nothing is granted\s+automatically/i)
  })

  it('tells them the address has to match, which is the failure people actually hit', () => {
    expect(INVITE).toMatch(/THIS email address/)
    expect(INVITE).toMatch(/only works for\s+the address it was sent to/i)
  })

  it('names the 6-digit code, since the link it replaced no longer arrives', () => {
    expect(INVITE).toMatch(/6-digit code/)
  })

  it('carries the landing link exactly once, and it is a bare URL on this site', () => {
    expect(INVITE.split(LINK)).toHaveLength(2)
    expect(LINK.startsWith(`${SITE_URL}/`)).toBe(true)
    // No secret and no address — the retirement made the link safe to log.
    expect(new URL(LINK).search).toBe('')
    expect(INVITE).not.toMatch(/[0-9a-f]{64}/)
  })

  it('closes by saying nothing has been granted to anybody', () => {
    expect(INVITE).toMatch(/Nothing has been granted to\s+anybody/i)
  })
})

describe('the approval email — sent after the access exists', () => {
  it('the subject is static and carries nothing anybody typed', () => {
    expect(APPROVAL_SUBJECT).toBe('Your DaScout admin access is now active')
    expect(APPROVAL_SUBJECT).not.toContain('@')
  })

  /**
   * The one instruction that matters. The role is read from the profiles row on every
   * request, so there is no link to open, nothing to accept and no need to sign out and
   * back in — and somebody who expects an action will go hunting for one.
   */
  it('says there is nothing to accept and no need to sign in again', () => {
    expect(APPROVAL).toMatch(/nothing to set up and nothing to accept/i)
    expect(APPROVAL).toMatch(/do not need to sign out and back in/i)
  })

  it('points at the admin panel on this site', () => {
    expect(APPROVAL).toContain(`${SITE_URL}/admin`)
  })

  it('states the limit of the access — they cannot invite or remove admins', () => {
    expect(APPROVAL).toMatch(/cannot/i)
    expect(APPROVAL).toMatch(/Invite or remove other admins/i)
  })

  it('says the panel records who did what', () => {
    expect(APPROVAL).toMatch(/recorded against the account that did it/i)
  })

  it('tells somebody who was not expecting it what to do', () => {
    expect(APPROVAL).toMatch(/were not expecting this/i)
  })

  /**
   * It takes no arguments, so there is nowhere for anybody's typing to get in. Two calls
   * are the same bytes for the same reason `inviteEmailBody` is tested that way.
   */
  it('is a constant: two calls produce identical bytes, and no address appears in it', () => {
    expect(approvalEmailBody()).toBe(APPROVAL)
    expect(APPROVAL).not.toContain('@')
  })

  it('carries no peso amount and no map — the standing rule, in email too', () => {
    expect(APPROVAL).not.toContain('₱')
    expect(APPROVAL).not.toMatch(/\bmaps?\b/i)
  })
})

describe('the "Confirm signup" template — the owner pastes this into Supabase', () => {
  /**
   * This one is NOT sent by this application. It is the dashboard template, and the only
   * two things a test can usefully hold it to are the two that decide whether the whole
   * code flow works at all.
   */
  it('uses the code placeholder', () => {
    expect(CONFIRM_SIGNUP_TEMPLATE).toContain('{{ .Token }}')
  })

  it('does NOT use the confirmation link placeholder it replaces', () => {
    expect(CONFIRM_SIGNUP_TEMPLATE).not.toContain('ConfirmationURL')
  })

  it('tells an invited person that entering the code is the last thing they do', () => {
    expect(CONFIRM_SIGNUP_TEMPLATE).toMatch(/last thing/i)
    expect(CONFIRM_SIGNUP_TEMPLATE).toMatch(/owner approves your account/i)
  })

  it('says the code is single use and short-lived', () => {
    expect(CONFIRM_SIGNUP_TEMPLATE).toMatch(/used once/i)
    expect(CONFIRM_SIGNUP_TEMPLATE).toMatch(/expires/i)
  })
})

describe('the sign-up sentence keeps pointing somewhere true', () => {
  it('names the code rather than the link it replaced', () => {
    expect(SIGNUP_SENT).toMatch(/6-digit code/)
    expect(SIGNUP_SENT).not.toMatch(/confirmation link/i)
  })

  /**
   * The uniformity rule from `lib/account/messages.ts` is unchanged by the rewording:
   * this sentence is returned for four different outcomes, so it may not contain a clause
   * that only one of them could produce. Nothing here may name an address or an account.
   */
  it('says nothing that could only be true of an address that exists', () => {
    expect(SIGNUP_SENT).not.toContain('@')
    expect(SIGNUP_SENT).toMatch(/If you already have an account/i)
  })
})
