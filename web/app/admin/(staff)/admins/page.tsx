import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/admin/auth'
import {
  ROLE_CHANGE_LIMIT,
  listAdminAccounts,
  listAdminCandidates,
  listAdminRoleChanges,
} from '@/lib/admin/queries'
import { InviteAdminForm } from '@/components/admin/InviteAdminForm'
import { CandidateActions } from '@/components/admin/CandidateActions'
import { RemoveAdminButton } from '@/components/admin/RemoveAdminButton'

export const metadata: Metadata = { title: 'Admins' }

/**
 * Who can open this panel, and the controls that change that.
 *
 * `requireSuperAdmin()` is the first line rather than `requireStaff()`, and that
 * difference is the whole feature: a staff admin has full access to every listing and no
 * access at all to this screen. It is still only the user-experience layer — the RPCs
 * behind every control raise 42501 for anyone else, and the `role` column is not in any
 * grant an API caller holds — but a staff admin should meet the wall as a redirect, not
 * as a red box on a form they were shown by mistake.
 *
 * THE INVITATIONS SECTION IS THE ONLY PLACE A ROLE IS GRANTED. Nothing else in this
 * product turns an invitation into admin access: no sign-in, no callback, no email match.
 * Two earlier designs completed the promotion automatically once the invited address held
 * a confirmed account and were rejected on security review — every attack they were
 * broken by now terminates here, in a list a person reads, which is visibility rather
 * than privilege. It also carries the cancel this product never had: any outstanding
 * invitation can be recalled, including one typed to the wrong address that will never
 * reach the queue's ready state.
 */
export default async function AdminAccountsPage() {
  await requireSuperAdmin()
  const [candidates, accounts, roleChanges] = await Promise.all([
    listAdminCandidates(),
    listAdminAccounts(),
    listAdminRoleChanges(),
  ])

  const staffCount = accounts.filter((account) => account.role === 'staff').length
  const queue = candidates.installed ? candidates.rows : []
  const waiting = queue.filter((candidate) => candidate.canApprove).length

  return (
    <>
      <h1>Admins</h1>
      <p className="lede">
        Everyone who can open this panel. {accounts.length} account
        {accounts.length === 1 ? '' : 's'}
        {staffCount ? ` · ${staffCount} invited admin${staffCount === 1 ? '' : 's'}` : ''}. Only
        you can invite or remove admins.
      </p>

      <InviteAdminForm />

      {/*
        The queue. It sits above the accounts list because it is the only part of this
        screen with work waiting on it — an account that already has access needs nothing
        from anybody, and an invitation does.

        The count in the heading is the number of rows that can actually be APPROVED, not
        the number of rows shown. A not-signed-up invitation is not waiting on the owner;
        it is waiting on the invitee, and counting it would report work that does not
        exist. The row itself is still listed, because cancelling it is the one thing the
        owner can do about it.
      */}
      <section className="apanel" aria-labelledby="invitesH">
        <h2 id="invitesH">
          Invitations
          {waiting > 0 && <span className="pill warn">{waiting} waiting</span>}
        </h2>
        <p className="sub2">
          Nobody here has any access yet. An invitation grants nothing until you approve
          it — and approving gives full access to create, edit, publish and delete every
          listing.
        </p>

        {!candidates.installed ? (
          /*
            Said, not hidden. The queue's database function is not on this database yet,
            and an empty list here would read as "nobody is waiting" — which is a worse
            thing to tell the owner than the truth.
          */
          <div className="empty">
            <b>The approval queue is not switched on yet</b>
            Invitations are still being created and still expire after seven days, but
            they cannot be listed or approved until the database update is applied.
            Everything else on this page works as normal.
          </div>
        ) : queue.length ? (
          <>
            <div className="alist">
              {queue.map((candidate) => (
                <div className="arow" key={candidate.inviteId}>
                  <span className={candidate.canApprove ? 'pill ok' : 'pill muted'}>
                    {candidate.stateLabel}
                  </span>
                  <div className="t">
                    {/*
                      The account's own name, falling back to the address that was
                      invited. This is deliberate: a mistyped invitation shows a
                      stranger's name against an address the owner does not recognise,
                      which is the moment the mistake is catchable — before the approval,
                      not after it.
                    */}
                    <b>{candidate.displayName}</b>
                    {candidate.displayName !== candidate.email && (
                      <span className="meta">{candidate.email}</span>
                    )}
                    <span className="meta">{candidate.metaLine}</span>
                  </div>
                  <CandidateActions
                    inviteId={candidate.inviteId}
                    email={candidate.email}
                    canApprove={candidate.canApprove}
                  />
                </div>
              ))}
            </div>
            <p className="amuted" style={{ marginTop: 14 }}>
              A row shows the account&rsquo;s own name once there is one. Before that it
              shows the address you invited, so a typo is obvious before you approve it.
            </p>
          </>
        ) : (
          <div className="empty">
            <b>No invitations outstanding</b>
            Invite someone with the form above. They will appear here once they have
            created an account and confirmed their email, and they get no access until you
            approve them.
          </div>
        )}
      </section>

      <section className="apanel" aria-labelledby="adminsH">
        <h2 id="adminsH">Accounts with admin access</h2>
        <p className="sub2">
          An invited admin can create, edit, publish and delete any listing. Removing their
          access leaves the account in place as an ordinary buyer account — their sign-in,
          favourites and history all survive.
        </p>

        {accounts.length ? (
          <div className="alist">
            {accounts.map((account) => (
              <div className="arow" key={account.id}>
                <span className={account.role === 'admin' ? 'pill ok' : 'pill'}>
                  {account.roleLabel}
                </span>
                <div className="t">
                  <b>
                    {account.fullName ?? account.email}
                    {account.isSelf ? ' · you' : ''}
                  </b>
                  <span className="meta">{account.email}</span>
                  <span className="meta">
                    {account.role === 'admin'
                      ? 'Can invite and remove admins'
                      : 'Full access to listings'}
                    {account.joinedLabel ? ` · joined ${account.joinedLabel}` : ''}
                  </span>
                </div>
                {account.canRemove && (
                  <RemoveAdminButton profileId={account.id} email={account.email} />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <b>No admin accounts yet</b>
            Invite one with the form above. They will get an email with a link that works
            once.
          </div>
        )}
      </section>

      {/*
        The visible half of the audit trail.

        Every grant and every removal is written by the two SECURITY DEFINER functions, in
        the same transaction as the role change itself, into a table with no INSERT policy
        and no UPDATE or DELETE grant for anybody. So this list cannot be edited from the
        product and cannot silently miss a change — it is the record, not a summary of one.

        Names come from `profiles.full_name`, with a short id where there is none. The
        email address lives in `auth.users`, which no API caller may read, and adding a
        privileged function to fetch it is a bigger surface than an audit line is worth.
      */}
      <section className="apanel" aria-labelledby="changesH">
        <h2 id="changesH">Recent access changes</h2>
        <p className="sub2">
          Who was given admin access and who had it taken away, newest first. The last{' '}
          {ROLE_CHANGE_LIMIT} are shown; the record itself keeps everything and cannot be
          edited or deleted from this panel.
        </p>

        {roleChanges.length ? (
          <div className="alist">
            {roleChanges.map((change) => (
              <div className="arow" key={change.id}>
                <span className={change.granted ? 'pill ok' : 'pill muted'}>
                  {change.granted ? 'Granted' : 'Removed'}
                </span>
                <div className="t">
                  <b>{change.targetName}</b>
                  <span className="meta">
                    {change.fromRoleLabel} → {change.toRoleLabel} · {change.viaLabel}
                  </span>
                  <span className="meta">
                    By {change.actorName}
                    {change.changedAtLabel ? ` · ${change.changedAtLabel}` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <b>No access changes recorded yet</b>
            Nothing has been granted or removed since this record started. Inviting an
            admin, or removing one, writes the first line here.
          </div>
        )}
      </section>
    </>
  )
}
