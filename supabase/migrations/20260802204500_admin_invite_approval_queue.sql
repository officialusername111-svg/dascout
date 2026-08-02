-- run-p9-invite-approval-queue — the owner approves an invited account by hand, and
-- NOTHING ELSE EVER GRANTS A ROLE.
--
-- WHAT THIS BUYS, IN ONE SENTENCE
-- -------------------------------
-- An email match now earns a place in a QUEUE, not a role. Two earlier designs
-- (`run-p7-invite-autoredeem`, `run-p8-invite-carry-token`) tried to complete the
-- promotion automatically once the invited address held a confirmed account. A security
-- review broke the first one repeatedly and the owner discarded the second. Every attack
-- those reviews found — a borrowed session, a handed-down phone, a stolen cookie, a
-- password reset on a reassigned mailbox, a mistyped invitation, an invite created but
-- never emailed — now terminates at "appears in a list the owner reads and decides on".
-- That is visibility, not privilege, and it is the whole security argument of this file.
--
-- So there are now exactly TWO doors that can write `profiles.role`, and both of them are
-- the owner's own hands:
--   * `approve_admin_invite(uuid)` — NEW, below. A super admin grants the role.
--   * `revoke_staff_admin(uuid)`   — a super admin takes it away.
-- A third existed and is RETIRED in §5: `redeem_admin_invite(text)`, the run-p6 token
-- path, by which the invitee promoted themselves. The function stays; its EXECUTE grant
-- does not. See §5 for the reasoning — the short version is that a second way in that the
-- approval queue cannot see is a control the owner does not have.
--
-- Both remaining doors are SECURITY DEFINER, make their own authorisation decision, and
-- are reachable only by `authenticated`. The column grants and the `guard_profile_role`
-- trigger from `20260802021757_admin_invites_and_super_admin_split.sql` still mean that
-- nothing else on the internet can write the column at all.
--
-- "PENDING APPROVAL" IS DERIVED. THERE IS NO NEW STATUS.
-- -----------------------------------------------------
-- An invitation is awaiting a decision exactly when it is:
--
--     status = 'pending'  AND  expires_at > now()  AND  its address matches an
--     auth.users row whose email_confirmed_at is not null
--
-- and that predicate is evaluated fresh, in SQL, every time it is asked. No fourth
-- status value, no trigger, no column, no sweeper — therefore nothing that can drift out
-- of step with the facts it claims to summarise. The existing status CHECK
-- (`pending`/`accepted`/`revoked`) is untouched, and so is the partial unique index that
-- keeps at most one live invitation per address.
--
-- The p7 review's F7 is the reason this is spelled out three times below: an EXPIRED
-- invitation still reads `status = 'pending'` in this schema, deliberately, because there
-- is no scheduler to sweep it. Anything that trusts the status name alone turns every
-- invitation ever issued into a standing grant. Both functions that act on an invitation
-- here carry `expires_at > now()` in their own WHERE clause; do not remove it, and do not
-- "simplify" the queue by dropping it.
--
-- THE MAILBOX FACTOR IS STILL CONTINGENT — AND THAT NOW MATTERS FAR LESS
-- ---------------------------------------------------------------------
-- `email_confirmed_at` can become non-null in ways that are not "the invitee read their
-- mail": the project's "Confirm email" setting being off, an admin-API auto-confirm, an
-- OAuth/OIDC/SAML identity, a direct SQL write (p7 finding F4). Under the rejected
-- designs that scalar was the last wall before a role. Here it decides only whether a row
-- appears in a list a human reads. That is the entire point of D2 in PLAN.md: the design
-- is no longer sensitive to how strong that one field is.
--
-- LOAD-BEARING ENVIRONMENT DEPENDENCY (carried from run-p6, unchanged)
-- -------------------------------------------------------------------
-- Two functions here read `auth.users` from inside a SECURITY DEFINER owned by postgres.
-- Verified working live 2026-08-02. The failure mode is SILENT: if that read ever
-- returned nothing, the queue would render empty — which on this screen reads as "nobody
-- is waiting" rather than as an error — and every approval would answer 'unconfirmed'.
-- The runbook's post-apply check for `list_admin_accounts` covers the same dependency;
-- extend it to `list_admin_candidates` at apply time.

-- ---------------------------------------------------------------------------
-- 1. The audit vocabulary has to grow, and here is why it may not be faked.
--
--    `public.admin_role_changes.via` was CHECK-constrained by
--    `20260802131500_property_number_and_role_audit.sql:119` to exactly two values:
--
--        'invite_redeemed'          — written by redeem_admin_invite, with
--                                     actor_id = target_id, because the invitee
--                                     presented their own secret and promoted
--                                     themselves. It asserts a deliberate act of
--                                     acceptance BY THE PERSON PROMOTED.
--        'revoked_by_super_admin'   — the owner took access away.
--
--    An approval is NEITHER. The actor is the super admin; the target is somebody else;
--    the invitee performed no act of acceptance at all (they created an account and
--    entered a code — that is proof of a mailbox, not consent to a role). Writing
--    'invite_redeemed' for an approval would put a claim in an append-only statutory
--    record that names the wrong actor and asserts a consent that never happened. p7's
--    F2 named this precise trap. It is not available to us.
--
--    So the CHECK is widened ADDITIVELY with a third value:
--
--        'approved_by_super_admin'  — the owner approved a pending invitation whose
--                                     address had reached a confirmed account.
--
--    It reads as the exact mirror of 'revoked_by_super_admin', which is what it is:
--    the same person, the same screen, the opposite direction.
--
--    WHY A DO BLOCK RATHER THAN `drop constraint if exists <name>`. The constraint was
--    declared INLINE on the column, so its name is generated by Postgres
--    (`admin_role_changes_via_check` in every version this project has run against, but
--    that is a convention, not a contract). A guessed name that does not match drops
--    nothing, silently — and then the ADD below succeeds under a name that is not in
--    force, leaving the OLD two-value constraint to refuse the first approval the owner
--    ever tries, weeks later, with a raw 23514 on their screen. The block finds the
--    constraint by what it SAYS instead of by what it is called, and the assertion after
--    it turns any residual mismatch into a loud failure at apply time, where it is cheap.
--    Same reasoning as §0 of the run-p6 migration asserting pgcrypto.
-- ---------------------------------------------------------------------------

do $$
declare
  con record;
begin
  for con in
    select c.conname
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class     r on r.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = r.relnamespace
     where n.nspname = 'public'
       and r.relname = 'admin_role_changes'
       and c.contype = 'c'
       and pg_catalog.pg_get_constraintdef(c.oid) like '%via%'
       and pg_catalog.pg_get_constraintdef(c.oid) like '%invite_redeemed%'
  loop
    execute format('alter table public.admin_role_changes drop constraint %I', con.conname);
  end loop;
end;
$$;

alter table public.admin_role_changes
  add constraint admin_role_changes_via_check
  check (via in ('invite_redeemed', 'revoked_by_super_admin', 'approved_by_super_admin'));

-- Fail here, at apply time, rather than on the owner's first approval.
do $$
begin
  if exists (
    select 1
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class     r on r.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = r.relnamespace
     where n.nspname = 'public'
       and r.relname = 'admin_role_changes'
       and c.contype = 'c'
       and pg_catalog.pg_get_constraintdef(c.oid) like '%via%'
       and pg_catalog.pg_get_constraintdef(c.oid) not like '%approved_by_super_admin%'
  ) then
    raise exception
      'a via CHECK that forbids approved_by_super_admin is still in force on public.admin_role_changes';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The queue: invitations waiting for the owner's decision.
--
--    THE GUARD IS AN EARLY RAISE, NOT A WHERE CLAUSE — the same rule, for the same
--    reason, as §9 `list_admin_accounts()`. This function hands real email addresses to
--    its caller. That is correct, because the caller is provably a super admin before a
--    single row is computed; it is correct ONLY because the check happens first. A
--    definer function that computes rows and then filters them is one careless refactor
--    away from leaking the lot. This one cannot be refactored into that shape without
--    deleting the raise, which is a visible act.
--
--    It is not an enumeration oracle: it takes no arguments, so it cannot be asked about
--    an address, and every address it returns is one the super admin typed into the
--    invite form themselves.
--
--    IT RETURNS EVERY LIVE INVITATION, IN TWO STATES — and the derived predicate is
--    returned as a FLAG rather than as row presence. `has_confirmed_account` is exactly
--    the D1 predicate ("its address matches an auth.users row whose email_confirmed_at is
--    not null"), evaluated fresh, stored nowhere.
--
--      has_confirmed_account = true  → the person exists and has proved their mailbox.
--                                      This is the row the owner can approve.
--      has_confirmed_account = false → invited, but nobody has created and confirmed an
--                                      account on that address yet. NOTHING may be
--                                      approved here — `approve_admin_invite` re-derives
--                                      the same fact and answers 'unconfirmed' — but the
--                                      row still has to be VISIBLE, because it is the one
--                                      the owner most often needs to cancel: an
--                                      invitation typed to the wrong address never
--                                      reaches a confirmed account and would otherwise be
--                                      invisible for seven days. That is p7's F2 cancel
--                                      gap, and hiding these rows would leave half of it
--                                      open.
--
--    The flag is display and sequencing only. It authorises nothing: the approval path
--    re-reads the invitation under a lock and re-resolves the account itself, so a stale
--    'true' on a screen buys nobody anything.
--
--    WHAT EACH COLUMN IS FOR — the residual risk of this whole design is the owner
--    approving the wrong person, so the queue must let them recognise who they are
--    looking at rather than just offering a button:
--      * invite_id          — what the approve/decline calls take. Not the profile id:
--                             the decision is about an INVITATION, and resolving it back
--                             to an account is the database's job, done again at approval
--                             time so a stale screen cannot aim it at somebody else.
--      * email              — the invitation's own address, which is the one thing that
--                             identifies which person this row is about.
--      * full_name          — the name on the account THEY created, null when there is no
--                             account yet or the account carries no name. The screen shows
--                             this name and falls back to the invited ADDRESS, which is
--                             the moment a mistyped invitation becomes obvious: a
--                             stranger's name sitting next to the owner's typo.
--      * account_created_at — when they signed up, null when nobody has. "Three minutes
--                             after I sent the invitation" and "eight months ago" are
--                             different stories, and the owner is entitled to see which.
--      * invited_at         — when the invitation was sent. The only date a
--                             not-signed-up row has to offer.
--      * invite_expires_at  — how long the decision can wait.
--
--    NOT filtered: an address whose account is ALREADY staff or admin still appears here
--    if a live invitation exists for it. Hiding it would leave an invitation the owner
--    cannot see and therefore cannot cancel, which is the gap this run exists to close.
--    `approve_admin_invite` answers honestly for both cases.
--
--    WHY A LATERAL WITH `limit 1` RATHER THAN A PLAIN LEFT JOIN. One invitation must
--    produce exactly one row. A plain join would produce TWO rows for one invitation if
--    two confirmed accounts shared the address — possible where SSO is enabled, since
--    Supabase exempts SSO users from the auth.users email uniqueness index — and the owner
--    would be looking at one invitation twice with no way to tell which "Approve" they
--    were pressing. The lateral collapses it to one row and `approve_admin_invite` refuses
--    that invitation outright with 'ambiguous', which is the only honest answer.
--
--    The match is on `lower(u.email)` because `admin_invites.email` is stored lower-cased
--    (its own CHECK) while `auth.users.email` is whatever GoTrue recorded.
--
--    Ordered ready-first, then oldest invitation first: the rows that can be acted on sit
--    at the top, and within each group the person who has waited longest comes first.
-- ---------------------------------------------------------------------------

create or replace function public.list_admin_candidates()
returns table (invite_id uuid, email text, full_name text,
               account_created_at timestamptz, invited_at timestamptz,
               invite_expires_at timestamptz, has_confirmed_account boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'only a super admin may list admin candidates'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    -- Every reference is table-qualified: the RETURNS TABLE column names double as
    -- plpgsql variables, so an unqualified `email` or `full_name` here would be
    -- ambiguous and the function would refuse to run.
    select i.id, i.email, a.full_name, a.created_at, i.created_at, i.expires_at,
           a.user_id is not null
      from public.admin_invites i
      left join lateral (
        select u.id as user_id, u.created_at, p.full_name
          from auth.users u
          left join public.profiles p
            on p.id = u.id
         where lower(u.email) = i.email
           and u.email_confirmed_at is not null
         order by u.created_at asc
         limit 1
      ) a on true
     where i.status = 'pending'
       -- Expiry is TIME-based, not status-based, in this schema (run-p6 §2). Without
       -- this line the queue would offer the owner invitations that are already dead.
       and i.expires_at > now()
     order by (a.user_id is not null) desc, i.created_at asc;
end;
$$;

revoke execute on function public.list_admin_candidates() from public;
revoke execute on function public.list_admin_candidates() from anon;
grant  execute on function public.list_admin_candidates() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The only door in this feature that grants a role.
--
--    IT RE-VERIFIES EVERYTHING. The caller has seen a queue, but a queue is a screenshot
--    of a moment: the invitation may have been superseded, revoked, accepted or expired
--    since it was drawn, and the account behind the address may have changed. So nothing
--    the screen believed is trusted. The invitation is re-read under a row lock, its
--    status and expiry are re-checked, and the confirmed account is resolved AGAIN from
--    the address rather than passed in. There is no profile id parameter on purpose:
--    a stale or tampered form cannot aim this at a different person, because it cannot
--    name a person at all.
--
--    `for update` on the invitation row is what makes two owner sessions (two tabs, a
--    double-clicked button) safe. The second one blocks, then re-reads the row Postgres
--    has just committed, sees `status = 'accepted'`, and answers 'not_pending' instead of
--    granting a second time. The guarded UPDATE below carries the same predicates a
--    second time as a belt, and its row count is checked.
--
--    IT REFUSES TO GUESS. If two confirmed accounts share the invited address — possible
--    only where SSO is enabled, since Supabase exempts SSO users from the auth.users
--    email uniqueness index (p7, unverifiable-assumption 3) — approving would promote an
--    arbitrary one of them. It answers 'ambiguous' and writes nothing.
--
--    IT CANNOT DEMOTE A SUPER ADMIN. Two layers: the early `already_admin` return, and
--    `where p.role <> 'admin'` on the upsert, carried verbatim from `redeem_admin_invite`.
--    An `admin` target also leaves the invitation PENDING rather than marking it accepted
--    — nothing happened, so the record must not say something did. Cancelling it is the
--    honest resolution, and §4 is how.
--
--    IT RETURNS A STATUS AND DOES NOT RAISE FOR "NOTHING TO DO". Seven answers, each a
--    genuinely different situation with a different next step for the owner. Compare
--    `redeem_admin_invite`, which collapses six failures into the single word 'invalid'
--    on purpose: that endpoint is reachable by anyone holding a session, so distinguishing
--    its failures would tell an outsider which tokens exist. This one is reachable only by
--    a super admin, about an address they typed themselves, from a list they were just
--    shown. There is nothing left here to enumerate, and a screen that cannot tell
--    "expired" from "already dealt with" sends the owner to the database to find out.
--    A caller who is NOT a super admin still gets a hard 42501 and learns nothing.
--
--    ACCEPTED_BY RECORDS THE SUPER ADMIN, NOT THE INVITEE — read this before changing it.
--    `invited_by` and `revoked_by` on this table both name the ACTOR, and by symmetry so
--    does `accepted_by`. Under this design the actor is the owner: the invitee performed
--    no act of acceptance. Writing the invitee's id there would let a reader of
--    `admin_invites` alone conclude that they accepted it themselves, which is exactly the
--    false-consent record §1 refuses to write in the audit table — so it must not be
--    written here either. WRINKLE, stated rather than hidden: `redeem_admin_invite` writes
--    the INVITEE into the same column, because on that path the invitee genuinely is the
--    actor. So the column means "who accepted this invitation", and which door was used is
--    read from `admin_role_changes.via`. Which account RECEIVED the role is always
--    `admin_role_changes.target_id`, on both paths.
--
--    THE AUDIT ROW IS IN THE SAME TRANSACTION as the role change, as it is for revocation
--    and redemption. A trail that can miss its own write is not a trail. It is written
--    only when the role ACTUALLY moved: a target who is already `staff` (invited twice,
--    approved twice) leaves it out, because `from_role <> to_role` is a constraint on that
--    table and a row recording no change is noise in the one place noise is expensive.
-- ---------------------------------------------------------------------------

create or replace function public.approve_admin_invite(invite_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor        uuid := (select auth.uid());
  inv_email    text;
  inv_status   text;
  inv_expires  timestamptz;
  granted      public.user_role;
  matches      integer;
  target       uuid;
  prior        public.user_role;
  touched      integer;
begin
  if not public.is_super_admin() then
    raise exception 'only a super admin may approve an admin invitation'
      using errcode = 'insufficient_privilege';
  end if;

  if invite_id is null then
    return 'not_found';
  end if;

  select i.email, i.status, i.expires_at, i.granted_role
    into inv_email, inv_status, inv_expires, granted
    from public.admin_invites i
   where i.id = invite_id
     for update;

  if not found                      then return 'not_found';   end if;
  if inv_status <> 'pending'        then return 'not_pending'; end if;
  if inv_expires <= now()           then return 'expired';     end if;

  -- Resolved from the ADDRESS, inside the function, exactly as `redeem_admin_invite`
  -- resolves the caller's own. Never from a parameter and never from a JWT claim.
  --
  -- `array_agg` rather than `min()`: Postgres has no `min(uuid)` aggregate, and the count
  -- and the id have to come from ONE evaluation of this predicate in any case — reading
  -- them in two statements is two chances for a later edit to change only one of them.
  select count(*), (array_agg(u.id order by u.created_at))[1]
    into matches, target
    from auth.users u
   where lower(u.email) = inv_email
     and u.email_confirmed_at is not null;

  if matches = 0 then return 'unconfirmed'; end if;
  if matches > 1 then return 'ambiguous';   end if;

  select p.role into prior from public.profiles p where p.id = target;

  if prior = 'admin' then
    -- A sitting super admin. Nothing is written, and the invitation stays pending so the
    -- owner can cancel it deliberately.
    return 'already_admin';
  end if;

  update public.admin_invites i
     set status      = 'accepted',
         accepted_at = now(),
         accepted_by = actor
   where i.id         = invite_id
     and i.status     = 'pending'
     and i.expires_at > now();

  get diagnostics touched = row_count;
  if touched = 0 then
    -- Unreachable while the row lock above holds; kept because the lock is one edit away
    -- from being removed and a silent double-grant is not an acceptable failure mode.
    return 'not_pending';
  end if;

  -- The profile row normally already exists (`handle_new_user` creates one per auth
  -- user); the INSERT arm is the belt for a row that was never created or was removed.
  -- `where p.role <> 'admin'` is carried verbatim from run-p6: an invitation must never
  -- be able to demote a super admin.
  insert into public.profiles as p (id, role)
  values (target, granted)
      on conflict (id) do update
     set role = excluded.role
   where p.role <> 'admin';

  if coalesce(prior, 'buyer') is distinct from granted then
    insert into public.admin_role_changes (actor_id, target_id, from_role, to_role, via)
    values (actor, target, coalesce(prior, 'buyer'), granted, 'approved_by_super_admin');
  end if;

  return 'approved';
end;
$$;

revoke execute on function public.approve_admin_invite(uuid) from public;
revoke execute on function public.approve_admin_invite(uuid) from anon;
grant  execute on function public.approve_admin_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Decline — which is also the CANCEL this product has never had.
--
--    p7's F2 recorded the gap as real TODAY and independent of any flow change: an
--    invitation sent to a mistyped address could not be recalled for seven days without
--    hand-written SQL, because `admin_invites` had exactly two mutation doors and neither
--    of them was "stop". This closes it.
--
--    So it deliberately does NOT require the invitation to have reached the queue. ANY
--    pending invitation can be declined — never emailed, emailed but never opened, sent to
--    an address that has no account, sent to the wrong person entirely, or sitting in the
--    queue awaiting a decision. Restricting it to queued rows would have left exactly the
--    invitations that most need recalling out of reach.
--
--    An EXPIRED invitation is still `status = 'pending'` in this schema and can therefore
--    be declined too. That is wanted: it grants nothing either way, and it lets the owner
--    tidy a list rather than live with a row that looks live and is not.
--
--    Shape: `admin_invites_revoked_shape` is `(status = 'revoked') = (revoked_at is not
--    null)`, so both columns move in the one statement or the row is refused. `revoked_by`
--    is outside that CHECK and is set here because an audit column nobody fills is not an
--    audit column. The supersede step in `create_admin_invite` writes the same three.
--
--    NO `admin_role_changes` ROW. Nothing's role moved, and that table's
--    `from_role <> to_role` CHECK says so structurally. The record of a cancellation is
--    the invitation row itself: status, revoked_at, revoked_by, kept forever (the partial
--    unique index is on pending rows only, so history is never overwritten).
--
--    Three answers, same reasoning as §3: the caller is the owner, looking at their own
--    list, and "it was already accepted a minute ago" is a different thing to tell them
--    than "that invitation is gone".
-- ---------------------------------------------------------------------------

create or replace function public.decline_admin_invite(invite_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor   uuid := (select auth.uid());
  touched integer;
begin
  if not public.is_super_admin() then
    raise exception 'only a super admin may decline an admin invitation'
      using errcode = 'insufficient_privilege';
  end if;

  if invite_id is null then
    return 'not_found';
  end if;

  update public.admin_invites i
     set status     = 'revoked',
         revoked_at = now(),
         revoked_by = actor
   where i.id     = invite_id
     and i.status = 'pending';

  get diagnostics touched = row_count;
  if touched > 0 then
    return 'declined';
  end if;

  -- Nothing moved. Either the row is not there at all, or it has already been accepted
  -- or revoked — and those two need different sentences on the screen.
  if exists (select 1 from public.admin_invites i where i.id = invite_id) then
    return 'not_pending';
  end if;

  return 'not_found';
end;
$$;

revoke execute on function public.decline_admin_invite(uuid) from public;
revoke execute on function public.decline_admin_invite(uuid) from anon;
grant  execute on function public.decline_admin_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RETIRING THE SELF-SERVICE DOOR — `redeem_admin_invite` is no longer callable.
--
--    READ THIS FIRST IF YOU ARE HERE BECAUSE REDEMPTION "IS BROKEN": it is not broken.
--    It is RETIRED, deliberately, by the owner's decision on 2026-08-02. The function is
--    still here and still correct; what it lost is its EXECUTE grant, so no API caller can
--    reach it. Restoring it is the one statement at the bottom of §6.
--
--    WHY. Approval and redemption are two doors into the same room, and only one of them
--    is in the design the owner approved. `redeem_admin_invite` lets the INVITEE promote
--    themselves — holding the emailed secret and a confirmed mailbox — without the super
--    admin doing anything at all. That was a sound two-factor door when it was the only
--    one (run-p6 reviewed it as such, and it is not a hole). It stops being sound the
--    moment a second, human-gated door exists beside it, for three reasons:
--
--      * It is a way in that the approval design does not know about. Somebody who
--        redeems never appears in `list_admin_candidates()` — the invitation is already
--        'accepted' — so the queue the owner reads is not a complete account of who got
--        access. A control the owner cannot see is a control the owner does not have.
--      * It silently defeats a decline. The owner can cancel an invitation right up to
--        the moment somebody presses Accept; after that the cancel button is gone and the
--        access is real. The race is small and it is exactly backwards: the slower party
--        should not be the one making the decision.
--      * The two doors write different audit rows for the same outcome. 'invite_redeemed'
--        says the invitee consented and acted; 'approved_by_super_admin' says the owner
--        decided. With both doors live, "how did this person get admin?" has two answers
--        and the trail has to be read to know which — for no benefit anybody asked for.
--
--    WHY REVOKE RATHER THAN DROP. A revoke is one statement and its inverse is one
--    statement, so this is reversible in seconds if the owner changes their mind or a
--    live invitation has to be honoured by hand. Dropping the function is not reversible
--    without re-applying its whole body from two migrations back, and it would break the
--    `accepted`/`accepted_by` semantics that already-redeemed rows were written under.
--    Nothing is gained by removing the code; everything is gained by removing the grant.
--
--    NOTHING IN THE APPLICATION CALLS IT ANY MORE. The server action that did
--    (`web/app/admin/invite/actions.ts`) is deleted, the token is no longer emailed, and
--    the one-hop cookie that carried it is gone with them. This revoke is the layer that
--    holds even against a hand-written PostgREST call, which is the only reason it is
--    here and not merely "we stopped calling it".
--
--    `postgres` and `service_role` are unaffected — they never depended on this grant.
--    A break-glass promotion is `approve_admin_invite`, or SQL in the dashboard.
-- ---------------------------------------------------------------------------

revoke execute on function public.redeem_admin_invite(text) from authenticated;

-- ---------------------------------------------------------------------------
-- 6. POST-APPLY CHECKS — required, not optional. Run these once, after applying.
--
--    Two of them exist because the failure they catch is SILENT, and one because it
--    cannot be tested from the application at all.
--
--    (a) THE auth.users READ STILL WORKS. `list_admin_candidates` reads `auth.users` from
--        inside a definer owned by postgres. If that read ever returned nothing the queue
--        would render EMPTY, which on this screen says "nobody is waiting" rather than
--        "something is broken". Signed in as the super admin:
--
--          select * from public.list_admin_candidates();
--
--        With the two live invitations outstanding this must return two rows. Zero rows
--        with invitations known to exist is a failure, not an empty queue.
--
--    (b) THE RETIREMENT TOOK. §5 is the only thing standing between an invitee and a
--        self-service promotion:
--
--          select has_function_privilege('authenticated',
--                 'public.redeem_admin_invite(text)', 'execute');
--
--        Must be FALSE. True means the revoke did not take or something re-granted it.
--
--    (c) THE AUDIT ROW NAMES THE RIGHT PEOPLE. **No automated test covers this and none
--        can until this migration is applied**, which is why it is written down here.
--        `approve_admin_invite` writes `actor_id` = the approving super admin and
--        `target_id` = the invitee. `redeem_admin_invite` legitimately writes
--        `actor_id = target_id` (there, the invitee IS the actor), so a future edit that
--        copies from it would produce a statutory record naming the wrong person — and
--        every existing test would still pass, because the unit tests stub the RPC and
--        the integration tests only assert 42501 refusals. The first evidence of the bug
--        would be the audit trail itself, quietly lying.
--
--        So, on the FIRST real approval, before trusting the trail:
--
--          select c.actor_id, c.target_id, c.from_role, c.to_role, c.via, c.changed_at
--            from public.admin_role_changes c
--           order by c.changed_at desc
--           limit 1;
--
--        Assert all four, and do not accept three of them:
--          * actor_id  = the super admin's profile id (the person who pressed Approve)
--          * target_id = the invited account's profile id — and NOT equal to actor_id
--          * to_role   = 'staff', from_role = whatever they were ('buyer')
--          * via       = 'approved_by_super_admin'   (never 'invite_redeemed')
--
--        The same query is the one to re-run after any future edit to §3.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 7. ROLLBACK (commented — not executed by this migration).
--
--     ONE THING HERE IS NOT FULLY REVERSIBLE, and it is the CHECK constraint. Dropping
--     the three functions restores the previous behaviour exactly — no column is dropped,
--     no row is deleted, no data is moved, and the two functions run-p6 and run-p7 created
--     are not touched. But narrowing `admin_role_changes_via_check` back to two values
--     FAILS if a single approval has already been recorded, because the existing rows
--     would violate it. That is correct and must not be worked around: the alternative is
--     deleting rows from an append-only statutory record to make a constraint fit.
--
--     If an approval has been recorded, LEAVE THE WIDENED CHECK IN PLACE. It grants
--     nothing on its own — with `approve_admin_invite` dropped, nothing can write the
--     third value, and the rows that already carry it stay readable and true.
--
--     begin;
--       drop function if exists public.decline_admin_invite(uuid);
--       drop function if exists public.approve_admin_invite(uuid);
--       drop function if exists public.list_admin_candidates();
--
--       -- Un-retires the self-service door (§5). This ONE statement is the whole undo.
--       -- It is also usable on its own, without the rest of this block, if a live
--       -- invitation ever has to be honoured the old way — but note the application no
--       -- longer emails a token or offers a page to present one, so a raw token would
--       -- have to be redeemed by hand against the RPC.
--       --
--       -- READ BEFORE RUNNING IT ON ITS OWN: this re-opens a PUBLIC endpoint. What made
--       -- that endpoint safe to be public is that all six of its failure reasons answer
--       -- with the single word 'invalid', so it cannot be used to find out which tokens
--       -- exist. That property is covered by
--       --   tests/vitest/admin-escalation-denial.integration.test.ts →
--       --   'redemption is either unreachable or uniformly refusing — never enumerable'
--       -- which asserts uniformity whenever the grant is present and the grant-layer
--       -- refusal whenever it is not, so it stays meaningful in both states. Re-run that
--       -- file after re-granting; a green run is the evidence the surface is still safe.
--       grant execute on function public.redeem_admin_invite(text) to authenticated;
--
--       -- ONLY IF no row carries the new value; check first:
--       --   select count(*) from public.admin_role_changes
--       --    where via = 'approved_by_super_admin';
--       -- alter table public.admin_role_changes drop constraint admin_role_changes_via_check;
--       -- alter table public.admin_role_changes
--       --   add constraint admin_role_changes_via_check
--       --   check (via in ('invite_redeemed', 'revoked_by_super_admin'));
--     commit;
--
--     Invitations already marked 'accepted' by an approval are NOT rolled back: the role
--     they granted is real and the people holding it are real. Undoing one is
--     `revoke_staff_admin`, which writes its own audit row saying so.
-- ---------------------------------------------------------------------------
