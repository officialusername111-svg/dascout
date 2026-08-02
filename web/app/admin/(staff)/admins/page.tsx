import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/admin/auth'
import { ROLE_CHANGE_LIMIT, listAdminAccounts, listAdminRoleChanges } from '@/lib/admin/queries'
import { InviteAdminForm } from '@/components/admin/InviteAdminForm'
import { RemoveAdminButton } from '@/components/admin/RemoveAdminButton'

export const metadata: Metadata = { title: 'Admins' }

/**
 * Who can open this panel, and the two controls that change that.
 *
 * `requireSuperAdmin()` is the first line rather than `requireStaff()`, and that
 * difference is the whole feature: a staff admin has full access to every listing and no
 * access at all to this screen. It is still only the user-experience layer — the RPCs
 * behind both controls raise 42501 for anyone else, and the `role` column is not in any
 * grant an API caller holds — but a staff admin should meet the wall as a redirect, not
 * as a red box on a form they were shown by mistake.
 *
 * There is no pending-invite list, no cancel and no resend this round: the owner asked
 * for exactly two controls. Re-inviting an address supersedes whatever was outstanding
 * for it, which covers "resend" without a second button that can be pressed by accident.
 */
export default async function AdminAccountsPage() {
  await requireSuperAdmin()
  const [accounts, roleChanges] = await Promise.all([listAdminAccounts(), listAdminRoleChanges()])

  const staffCount = accounts.filter((account) => account.role === 'staff').length

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
