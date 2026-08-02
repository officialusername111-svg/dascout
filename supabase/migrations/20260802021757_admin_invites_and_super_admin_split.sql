-- run-p6-admin-invites — the admin/staff privilege split, made real at the database.
--
-- WHY THIS EXISTS
-- ---------------
-- Today `public.is_staff()` is true for BOTH the `staff` and `admin` roles, and the only
-- thing standing between a `staff` session and the `admin` role is a trigger that asks
-- exactly that predicate:
--
--     if new.role is distinct from old.role and not public.is_staff() then raise ...
--
-- Combined with `profiles_staff_all` (`for all to authenticated using (is_staff())`), a
-- signed-in `staff` user can issue one PostgREST PATCH against their own profiles row and
-- come back an `admin`. That is a full privilege escalation and it is the whole reason for
-- this migration.
--
-- `is_staff()` is deliberately NOT redefined. Twenty-odd policies across listings, photos,
-- features, price history, verification events and storage use it to mean "may work the
-- listing panel", and the owner's rule 1 is that staff admins keep FULL access to every
-- listing. Narrowing `is_staff()` would revoke listing access from the very people this
-- feature creates. Instead this migration adds a second, narrower predicate
-- (`is_super_admin()`) and tightens ONLY the role-changing path, in three layers:
--
--   Layer 1 — COLUMN GRANTS.  `authenticated` loses INSERT/UPDATE/DELETE on public.profiles
--             and gets back only `update (full_name)`. The `role` column becomes unwritable
--             through PostgREST by ANY caller, super admin included. Grants are checked
--             before RLS and before triggers, so this holds even if a future policy is
--             written carelessly.
--   Layer 2 — RLS POLICY.  `profiles_staff_all` (the blanket for-all staff policy) is
--             dropped outright. The only API-reachable UPDATE policy left is
--             `profiles_update_own`.
--   Layer 3 — TRIGGER.  `guard_profile_role()` now demands `is_super_admin()` instead of
--             `is_staff()` for any role change or role-bearing insert arriving on a
--             non-privileged role, and additionally refuses a super admin's attempt to set
--             their OWN role.
--
-- HOW MANY LAYERS ACTUALLY DEFEND WHICH ATTACK — state this honestly, because a maintainer
-- who believes "there are three" may remove one:
--
--   * Promoting SOMEONE ELSE ......... 3 layers (grant, RLS, trigger).
--   * Promoting YOURSELF ............. 2 layers (grant, trigger). RLS does NOT defend here:
--     `profiles_update_own` deliberately permits the caller's own row and permissive
--     policies OR together, so the row passes RLS. Self-promotion is the exact attack this
--     migration exists to close, and the column grant plus the trigger are what close it.
--
-- Role changes therefore have exactly two legitimate doors, both SECURITY DEFINER functions
-- in this file that make their own authorisation decision: `redeem_admin_invite()` (the
-- invitee promotes themselves, once, holding a secret emailed to an address they have proven
-- they control) and `revoke_staff_admin()` (a super admin demotes a staff admin).
--
-- WHY THE TOKEN IS NOT THE ROW'S UUID
-- -----------------------------------
-- `20260731134740_request_email_confirmation.sql` used the request row's own uuid as the
-- confirmation token and documented, honestly, why that was tolerable: the anon INSERT
-- surface let a direct API caller supply their own row id and self-confirm, and the prize
-- was an alert subscription nobody would fight for. Neither half of that reasoning transfers
-- here. The prize is admin access, so the token is 256 bits of `gen_random_bytes`, stored
-- only as a SHA-256 hash (the raw value exists exactly twice: in the function's return value
-- and in the invitee's mailbox), single-use and expiring. And `admin_invites` carries NO
-- insert policy for `anon` or `authenticated` and no INSERT grant for them either — the
-- "craft your own row, then redeem it" path does not exist, because nothing reachable from
-- the internet can create a row at all.
--
-- LOAD-BEARING ENVIRONMENT DEPENDENCY
-- -----------------------------------
-- Two functions here (`redeem_admin_invite`, `list_admin_accounts`) read `auth.users` from
-- inside a SECURITY DEFINER owned by postgres. That read was verified working against the
-- live project at intake (2026-08-02). It matters because the failure mode is SILENT: if the
-- read ever returned nothing, redemption would answer 'invalid' forever — indistinguishable
-- from a bad token — and the admin list would render empty, which on a security screen reads
-- as "there are no admins". The runbook carries a post-apply query that proves the read still
-- works; do not remove it.

-- ---------------------------------------------------------------------------
-- 0. Assert the crypto dependency.
--
--    pgcrypto IS already installed in schema `extensions` on the live project, so this is a
--    no-op there. It is here because plpgsql bodies are NOT name-resolved at CREATE time:
--    without it the whole file would apply 100% clean and then throw 42883
--    (`function extensions.gen_random_bytes(integer) does not exist`) on the owner's first
--    invite. It also makes `supabase db reset` reproduce this schema from nothing.
--    `if not exists` skips silently when the extension is already present, whatever schema
--    it lives in — it does not attempt to move it.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. The super-admin predicate.
--
--    Mirrors is_staff() exactly (stable, definer, pinned search_path) so a policy can ask
--    "is the caller a super admin?" without the caller needing read access to other
--    profiles rows and without RLS recursing into itself. It reads the profiles row, never
--    a JWT claim: a claim minted at sign-in survives a demotion, a row does not.
--
--    Grants follow 20260729130844: PUBLIC's default EXECUTE is dropped, anon never gets it
--    (an anonymous caller is never a super admin, and leaving the grant would publish
--    /rest/v1/rpc/is_super_admin to the internet), and `authenticated` gets it because RLS
--    policy expressions are evaluated with the calling role's own privileges.
-- ---------------------------------------------------------------------------

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  );
$$;

revoke execute on function public.is_super_admin() from public;
revoke execute on function public.is_super_admin() from anon;
grant  execute on function public.is_super_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The invite table.
--
--    Shape notes, each one load-bearing:
--
--    * `token_hash bytea not null unique` — the hash, never the token. UNIQUE both enforces
--      "one row per token" and gives redemption its only lookup an index seek.
--    * `status text` + CHECK rather than a new enum. The repo's house style is enums
--      (user_role, listing_status) and this is a deliberate departure. The reason is NOT
--      that enum values cannot be added inside a transaction — that restriction was relaxed
--      in PG12 and this project runs PG17. The reason is reversibility and vocabulary: a
--      CHECK constraint can be widened AND narrowed back, whereas an enum label, once added,
--      is permanent and undroppable. Invite lifecycle is implementation vocabulary that rule
--      2 says will grow (pending-list / cancel / resend arrive in a later round), unlike
--      `user_role`, which is settled domain vocabulary and rightly an enum.
--    * `revoked_at` / `revoked_by` exist from day one even though no UI sets them this
--      round — rule 2 asks for exactly that. `create_admin_invite` already uses them (see
--      the supersede step in §6), so they are not dead weight.
--    * `granted_role` records what the invite buys, pinned to 'staff' by a CHECK. An invite
--      must never be able to mint another super admin, and stating that as data rather than
--      as a literal buried in the redemption function makes a future second tier additive.
--    * `invited_by` / `accepted_by` / `revoked_by` are nullable with ON DELETE SET NULL,
--      matching price_history.changed_by and verification_events.performed_by: the audit row
--      outlives the actor's account, and a deleted account must not be blocked by, or take
--      with it, the history of what it did.
--    * `expires_at` is bounded on BOTH sides. A row may not be born already expired, and may
--      not carry an expiry more than 30 days out, so no caller or future code path can
--      quietly mint a near-immortal admin-granting secret. Rule 3's 7 days is the default.
-- ---------------------------------------------------------------------------

create table if not exists public.admin_invites (
  id           uuid primary key default gen_random_uuid(),
  -- stored already lower-cased and syntactically checked; redemption compares it to the
  -- caller's own auth.users email, so a mixed-case row would silently never redeem.
  email        text not null
                 check (email = lower(email))
                 check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  token_hash   bytea not null unique,
  granted_role public.user_role not null default 'staff'
                 check (granted_role = 'staff'::public.user_role),
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'revoked')),
  invited_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '7 days'),
  accepted_at  timestamptz,
  accepted_by  uuid references public.profiles(id) on delete set null,
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles(id) on delete set null,
  -- the status column and its timestamps can never disagree
  constraint admin_invites_accepted_shape check ((status = 'accepted') = (accepted_at is not null)),
  constraint admin_invites_revoked_shape  check ((status = 'revoked')  = (revoked_at  is not null)),
  -- Written as a subtraction, not `created_at + interval '30 days'`, because
  -- timestamptz + interval is only STABLE (it depends on TimeZone) and Postgres refuses a
  -- non-immutable expression in a CHECK. timestamptz - timestamptz is immutable.
  constraint admin_invites_expiry_window  check (expires_at > created_at
                                                 and expires_at - created_at <= interval '30 days')
);

-- At most one LIVE token per address, enforced by the database rather than by whoever wrote
-- the form. Two consequences, both wanted: a double-submitted invite form cannot leave two
-- admin-granting secrets in flight, and `create_admin_invite` re-inviting the same address
-- is a genuine "resend" (the old token is revoked first, §6) instead of an accumulation.
-- Partial, so the row keeps its history forever once accepted or revoked.
-- NOTE: expiry is time-based, not status-based — an expired row stays 'pending'. That is
-- deliberate (a status sweeper would need a scheduler this project does not have); the
-- supersede step means it never blocks a re-invite.
create unique index if not exists admin_invites_one_pending_per_email_idx
  on public.admin_invites (email)
  where status = 'pending';

alter table public.admin_invites enable row level security;

-- ---------------------------------------------------------------------------
-- 3. admin_invites grants and policies.
--
--    THE ABSENCE HERE IS THE FEATURE. There is no INSERT, UPDATE or DELETE policy for anon
--    or authenticated, and — belt and braces, because a grant is checked before a policy —
--    no INSERT/UPDATE/DELETE *grant* either. RLS denies by default, so with no policy the
--    answer to "may I write this table?" is no for every internet-reachable caller, with no
--    predicate to get wrong. Rows come into existence through one door only:
--    `create_admin_invite`, a SECURITY DEFINER function that checks `is_super_admin()`
--    itself. Rows change state through two: that function's supersede step and
--    `redeem_admin_invite`.
--
--    SELECT is COLUMN-SCOPED and excludes `token_hash`, so no future pending-invite screen
--    can put a hash on the wire even by accident. Recorded panel disagreement: the scope
--    lens argued for dropping the SELECT grant entirely as surface the owner declined this
--    round; the security lens argued for column-scoping. Column-scoping was taken — it keeps
--    rule 2's "additive later" shape while removing the exposure.
--
--    CONSEQUENCE FOR CALLERS, do not discover this at runtime: with a column-scoped grant,
--    `SELECT *` fails (it expands to every column, including the ungranted one). PostgREST
--    callers must name columns explicitly — `?select=id,email,status,expires_at` — which is
--    the habit we want on this table anyway.
-- ---------------------------------------------------------------------------

revoke all on table public.admin_invites from anon, authenticated;
grant  select (id, email, granted_role, status, invited_by, created_at,
               expires_at, accepted_at, accepted_by, revoked_at, revoked_by)
  on table public.admin_invites to authenticated;

drop policy if exists admin_invites_super_admin_read on public.admin_invites;
create policy admin_invites_super_admin_read on public.admin_invites
  for select to authenticated
  using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 4. Layer 1 + Layer 2: take the role column away from the API, and retire the blanket
--    staff policy on profiles.
--
--    RLS decides which ROWS a statement may touch and says nothing about which COLUMNS —
--    the same gap 20260730095404 closed on listing_views, closed the same way here. After
--    this, `role` is not in any UPDATE grant held by `authenticated`, so a PATCH that names
--    it fails with "permission denied for table profiles" (SQLSTATE 42501) before RLS or
--    the trigger is consulted, whoever the caller is. The super admin included: demotion
--    goes through `revoke_staff_admin()` in §7, which can enforce rules a column grant
--    cannot.
--
--    INSERT and DELETE go too. Evidence they are unused: the only three places the app
--    touches this table (web/app/admin/actions.ts:348, web/app/account/actions.ts:412,
--    web/lib/admin/auth.ts:66) are all `.select('role')` reads; profile rows are created by
--    the `handle_new_user` trigger (SECURITY DEFINER, owned by postgres, unaffected by these
--    grants) and removed by the ON DELETE CASCADE from auth.users, which runs privileged.
--    Removing DELETE also closes a lockout vector: with it, a super admin could delete the
--    last admin's profile row and leave nobody able to invite or demote.
--
--    `profiles_staff_all` is dropped and NOT replaced. A super-admin UPDATE policy was
--    considered and cut: after the column grant its only reachable effect would be writing
--    `full_name` on other people's rows, which no app code does and no rule asks for, and
--    both definer RPCs bypass RLS as the table owner so neither needs it. What remains is
--    the narrowest honest statement of what the app actually does: `profiles_update_own`
--    (your row) intersected with `update (full_name)` (your display name).
--    `profiles_select_own_or_staff` is untouched — staff still read every profile, which
--    the admin panel needs.
--
--    Note on `service_role`: it keeps its Supabase-default grants here and carries BYPASSRLS,
--    so neither of the two layers above constrains it. The trigger in §5 does — a service_role
--    caller is not a member of postgres, and its JWT carries no `sub`, so `is_super_admin()`
--    is false and a role write is refused. That is deliberate. The one place a service-role
--    key is used in this repo (scripts/upload-photos.mjs:29, a local operator script; the key
--    is absent from the Vercel deployment, which is what 20260731134740 meant) touches
--    storage and listings, never profiles.
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.profiles from anon, authenticated;
grant  update (full_name)     on public.profiles to   authenticated;

drop policy if exists profiles_staff_all           on public.profiles;
drop policy if exists profiles_super_admin_update  on public.profiles;

-- ---------------------------------------------------------------------------
-- 5. Layer 3: the fixed role guard.
--
--    Four changes from the 20260727163720 original.
--
--    (a) The predicate is `is_super_admin()`, not `is_staff()`. This is the line that turns
--        "any staff member may rewrite any role" into "only the owner tier may".
--
--    (b) The check applies only to statements NOT running with the privileges of `postgres`.
--        SECURITY DEFINER changes current_user to the function's owner while leaving the
--        request's JWT claims alone — the same property 20260729233249 relies on to record
--        the real staff actor inside `guard_listing_publish`. So this branch is what lets the
--        definer doors do their work after making their own, stricter authorisation decision,
--        and — critically — it is what keeps the Supabase SQL editor working as the
--        break-glass recovery path. (Under the original wording a dashboard session, which
--        has no JWT, hit `not is_staff()` and was refused; a session that is already postgres
--        could simply drop the trigger, so guarding it was never a real control, only a
--        papercut on the one recovery route this project has.)
--
--        The test is written as an ALLOWLIST so it fails CLOSED. `pg_has_role(current_user,
--        'postgres', 'member')` is true for postgres itself (the member = role fast path in
--        is_member_of_role) and for any superuser such as supabase_admin (the same function
--        short-circuits on superuser_arg), and false for anon, authenticated, authenticator
--        and service_role — and for any role Supabase adds in future, which is the point. A
--        denylist would wave through anything it forgot to name. If the role `postgres` did
--        not exist the function would raise, which also refuses the write: the failure mode
--        is closed in both directions. The four known API roles are named as a second
--        conjunct purely as a belt — it costs one line and it holds even in the absurd case
--        where somebody grants `postgres` to `authenticated`.
--
--    (b-i) THE GUARD ITSELF MUST BE SECURITY INVOKER — this is the subtle part. The original
--        was SECURITY DEFINER out of habit; a definer trigger sees current_user = its own
--        owner on EVERY call, including a plain PostgREST PATCH, so the test in (b) would be
--        true for everybody and the guard would never fire. As INVOKER the trigger observes
--        the role the statement is actually running under: `authenticated` for an API caller,
--        `postgres` inside the definer doors. No capability is lost by the change — the body
--        touches no table directly, it only calls two functions, and `is_super_admin()` is
--        itself definer so it still reads profiles without the caller needing rights on it.
--        Trigger execution is not privilege-checked against the invoking user
--        (20260727164012 §2), so the EXECUTE revocation below still stands.
--
--    (c) New: a super admin may not set their OWN role. With no UI able to create a second
--        super admin, self-demotion is the one move that empties the tier and locks everyone
--        out of invites and demotions. Blocking it makes "at least one super admin exists"
--        an invariant of every API-reachable path, without a count query and without a race.
--
--    (d) New: the trigger now fires on INSERT as well as UPDATE. Not because the insert path
--        is reachable today — §4 revoked the grant and RLS default-denies — but because the
--        UPDATE path has layers behind it and the INSERT path had none. One future migration
--        adding a `for insert` policy in the old blanket shape would reopen "delete my
--        profile row, re-insert it as admin" with no trigger underneath. The INSERT arm
--        passes a row whose role is 'buyer' straight through, because that is the column
--        default and therefore the path EVERY signup takes: `handle_new_user` names no role,
--        so NEW.role is already 'buyer' by the time a BEFORE trigger sees it. (That function
--        would pass the privileged test as well — it is SECURITY DEFINER owned by postgres —
--        so signup is covered twice over. Verified both ways rather than assumed.) OLD is
--        unassigned during an INSERT trigger, so the old-vs-new comparison is gated on TG_OP;
--        reading `old.role` there would raise "record old is not assigned yet".
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security invoker            -- see (b-i): a definer trigger cannot see who the caller is
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.role is not distinct from old.role then
      return new;
    end if;
  else
    -- INSERT: a row born at the bottom tier grants nothing and needs no authorisation.
    if new.role = 'buyer' then
      return new;
    end if;
  end if;

  if not pg_catalog.pg_has_role(current_user, 'postgres', 'member')
     or current_user in ('anon', 'authenticated', 'authenticator', 'service_role') then

    if not public.is_super_admin() then
      raise exception 'only a super admin may set a profile role'
        using errcode = 'insufficient_privilege';
    end if;

    if new.id = (select auth.uid()) then
      raise exception 'a super admin may not set their own role'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

-- The execute revocation from 20260727164012 survives CREATE OR REPLACE. Restated for the
-- same reason 20260729233249 restates its own: grants should say what we mean.
revoke execute on function public.guard_profile_role() from public, anon, authenticated;

-- Recreated rather than replaced, because the original is UPDATE-only and (d) needs INSERT.
drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before insert or update on public.profiles
  for each row execute function public.guard_profile_role();

-- ---------------------------------------------------------------------------
-- 6. Door one: creating an invite.
--
--    Why an RPC rather than an INSERT policy: a policy would have to be written
--    `for insert to authenticated with check (is_super_admin())`, which is an INSERT surface
--    on an admin-granting table reachable by every signed-in account — one predicate away
--    from disaster, and it would put the token's generation in the caller's hands. With the
--    RPC, the table has no write surface at all and the secret is minted by the database:
--    32 bytes from gen_random_bytes (the CSPRNG), returned hex-encoded to the caller exactly
--    once so it can be emailed, and stored only as a SHA-256 digest. Nothing that is written
--    down can be redeemed.
--
--    Failure is a hard exception, not a uniform silent shape: the only caller who can reach
--    this is the owner, and enumeration is meaningless when the argument is an address the
--    caller just typed.
--
--    The supersede step keeps at most one live token per address (see the partial unique
--    index in §2) and doubles as the resend the owner declined to build a button for this
--    round: inviting the same address again kills the previous token and issues a new one.
-- ---------------------------------------------------------------------------

create or replace function public.create_admin_invite(invite_email text)
returns table (invite_id uuid, invite_token text, invite_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller     uuid := (select auth.uid());
  normalised text := lower(trim(coalesce(invite_email, '')));
  fresh      text;
begin
  if not public.is_super_admin() then
    raise exception 'only a super admin may create an admin invite'
      using errcode = 'insufficient_privilege';
  end if;

  if normalised !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'a valid email address is required'
      using errcode = 'check_violation';
  end if;

  update public.admin_invites i
     set status     = 'revoked',
         revoked_at = now(),
         revoked_by = caller
   where i.email  = normalised
     and i.status = 'pending';

  fresh := encode(extensions.gen_random_bytes(32), 'hex');

  -- Two super-admin sessions submitting the same address at the same moment both pass the
  -- supersede step and then race on admin_invites_one_pending_per_email_idx. Without this
  -- handler the loser sees a raw 23505 with the index name on the owner's screen.
  begin
    insert into public.admin_invites (email, token_hash, invited_by, expires_at)
    values (normalised,
            extensions.digest(fresh, 'sha256'),
            caller,
            now() + interval '7 days')
    returning id, expires_at into invite_id, invite_expires_at;
  exception
    when unique_violation then
      raise exception 'an invite for that address was just created; open the newest one'
        using errcode = 'check_violation';
  end;

  invite_token := fresh;
  return next;
end;
$$;

revoke execute on function public.create_admin_invite(text) from public;
revoke execute on function public.create_admin_invite(text) from anon;
grant  execute on function public.create_admin_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Door two: demoting a staff admin.
--
--    Needed because §4 took the role column away from every API caller, the owner included.
--    Three rules the column grant could not have expressed:
--      * only a super admin may call it (checked here, not by a policy);
--      * only a `staff` row may be demoted — an `admin` row is out of reach, so the super
--        admin tier cannot be emptied by peer removal, and (with §5c) not by self-demotion
--        either;
--      * the target is demoted to `buyer`, so the account, its favourites and its history
--        all survive. Revoking a privilege must not destroy a person's data.
--
--    KNOWN, ACCEPTED: demotion always lands on `buyer`, so a `broker` who was promoted to
--    staff comes back as a buyer, silently losing the broker assignment. No impact today —
--    `broker` is nullable-and-unused in v1 (see the core-schema comment on listings.broker_id)
--    — but it is written down here rather than discovered later.
--
--    NOT auditable: this function writes no record of who demoted whom or when. Promotions
--    leave a trail in admin_invites.accepted_at/accepted_by; demotions leave none. A proper
--    append-only audit table is parked as a proposal for the owner's decision, deliberately
--    not built in this run.
--
--    Returns a status rather than raising on a miss, so the admin screen can say "nothing to
--    do" without an error path. A non-super-admin caller still gets a hard denial.
-- ---------------------------------------------------------------------------

create or replace function public.revoke_staff_admin(target_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  touched integer;
begin
  if not public.is_super_admin() then
    raise exception 'only a super admin may revoke an admin'
      using errcode = 'insufficient_privilege';
  end if;

  if target_id is null or target_id = (select auth.uid()) then
    return 'no_change';
  end if;

  update public.profiles p
     set role = 'buyer'
   where p.id   = target_id
     and p.role = 'staff';

  get diagnostics touched = row_count;
  return case when touched > 0 then 'revoked' else 'no_change' end;
end;
$$;

revoke execute on function public.revoke_staff_admin(uuid) from public;
revoke execute on function public.revoke_staff_admin(uuid) from anon;
grant  execute on function public.revoke_staff_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Door three: redeeming an invite.
--
--    Granted to `authenticated` only, NEVER to anon. Redemption is not "here is a token,
--    make me an admin"; it is "I am already signed in as this person, and this person was
--    invited". Three facts must line up, and the caller controls only one of them:
--
--      1. the presented token hashes to a row that is still 'pending' and not yet expired
--         (single use and the 7-day window live in the WHERE clause, never in the caller);
--      2. that row's email equals the caller's OWN email, read from auth.users inside the
--         definer — not from a parameter, not from a JWT claim the client could shape;
--      3. that email is confirmed.
--
--    READ THIS BEFORE TOUCHING (3). The mailbox factor is CONTINGENT, not absolute. It is
--    worth something only while the Supabase project keeps "Confirm email" ENABLED. If that
--    setting is ever switched off, GoTrue populates email_confirmed_at at signup, this check
--    passes for everyone, and the invite silently degrades from two factors to a single-factor
--    bearer token: anyone holding a forwarded or shoulder-surfed invite mail can register the
--    invitee's address and redeem straight into `staff`. Project-level email confirmation is
--    therefore a hard precondition of this migration, enforced at the deploy gate, not a
--    preference. With it on, an attacker needs the token AND control of the mailbox — two
--    independent facts, which is the whole point of the check.
--
--    Rule 4 (an invited address that already has a buyer account is promoted in place) is
--    the UPDATE branch of the upsert: same auth user, same profile row, same favourites and
--    history, one column different. The `role <> 'admin'` guard means an invite can never
--    DEMOTE a sitting super admin who happens to redeem one.
--
--    Every failure — no such token, expired, already used, revoked, wrong mailbox,
--    unconfirmed mailbox, not signed in — returns the single value 'invalid'. Six reasons,
--    one answer, so the endpoint cannot be used to probe which tokens exist. 'accepted' is
--    reachable only by the invitee themselves, so returning it leaks nothing to anyone else,
--    and the redemption page needs it to say whether the promotion happened.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_admin_invite(raw_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller           uuid := (select auth.uid());
  -- The emitted alphabet is lower-case hex, so lower(trim(...)) removes no entropy at all.
  -- It rescues an invitee whose mail client wrapped, padded or case-shifted the link from an
  -- unexplainable 'invalid'.
  presented        text := lower(trim(coalesce(raw_token, '')));
  caller_email     text;
  caller_confirmed timestamptz;
  matched_id       uuid;
  matched_role     public.user_role;
begin
  if caller is null then
    return 'invalid';
  end if;

  -- Bound the input before hashing it; a well-formed token is 64 hex characters.
  if length(presented) not between 32 and 256 then
    return 'invalid';
  end if;

  -- DEPENDENCY: this read only works because the function is definer-owned by postgres.
  -- If it ever returns nothing, every redemption answers 'invalid' forever and looks exactly
  -- like a bad token. Verified live 2026-08-02; the runbook re-checks it after apply.
  select u.email, u.email_confirmed_at
    into caller_email, caller_confirmed
    from auth.users u
   where u.id = caller;

  if caller_email is null or caller_confirmed is null then
    return 'invalid';
  end if;

  update public.admin_invites i
     set status      = 'accepted',
         accepted_at = now(),
         accepted_by = caller
   where i.token_hash = extensions.digest(presented, 'sha256')
     and i.status     = 'pending'
     and i.expires_at > now()
     and i.email      = lower(caller_email)
  returning i.id, i.granted_role into matched_id, matched_role;

  if matched_id is null then
    return 'invalid';
  end if;

  -- The profile row normally already exists (handle_new_user creates one per auth user);
  -- the INSERT arm is the belt for a row that was never created or was removed.
  insert into public.profiles as p (id, role)
  values (caller, matched_role)
      on conflict (id) do update
     set role = excluded.role
   where p.role <> 'admin';

  return 'accepted';
end;
$$;

revoke execute on function public.redeem_admin_invite(text) from public;
revoke execute on function public.redeem_admin_invite(text) from anon;
grant  execute on function public.redeem_admin_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The admin roster, for the demote screen.
--
--    public.profiles carries id, full_name and role — no email. Email lives in auth.users,
--    which neither anon nor authenticated can read with the publishable key. A demote screen
--    built on a direct profiles select could therefore only render full_name, which is
--    nullable (handle_new_user copies it from raw_user_meta_data ->> 'full_name', which is
--    frequently absent). Asking the owner to choose which admin to revoke from a list of
--    blank names is not a usable control, so AC7 needs this function to be met at all.
--
--    THE GUARD IS AN EARLY RAISE, NOT A WHERE CLAUSE. This function hands real email
--    addresses to its caller. That is correct — the caller is provably a super admin before a
--    single row is computed — but only because the check happens first. A definer function
--    that computes rows and then filters them is one careless refactor away from leaking the
--    lot; this one cannot be refactored into that shape without deleting the raise.
--
--    It is not an enumeration oracle: it takes no arguments, so it cannot be asked about an
--    address, and it returns only accounts that already hold `staff` or `admin` — exactly the
--    set a super admin is entitled to see. It can neither confirm nor deny that any other
--    address has an account.
--
--    Ordered `role desc` (the user_role enum declares buyer < broker < staff < admin, so the
--    super admin sorts first) then oldest-first, giving the screen a stable list.
-- ---------------------------------------------------------------------------

create or replace function public.list_admin_accounts()
returns table (profile_id uuid, email text, full_name text,
               role public.user_role, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'only a super admin may list admin accounts'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    -- Same auth.users dependency as §8, and the same silent failure mode: if this join ever
    -- produced nothing the screen would render an empty list, which on a security screen
    -- reads as "there are no admins" rather than as an error. The runbook checks it.
    -- Every reference is table-qualified: the RETURNS TABLE column names double as plpgsql
    -- variables, and an unqualified `role` or `created_at` here would be ambiguous.
    select p.id, u.email::text, p.full_name, p.role, p.created_at
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.role in ('staff', 'admin')
     order by p.role desc, p.created_at asc;
end;
$$;

revoke execute on function public.list_admin_accounts() from public;
revoke execute on function public.list_admin_accounts() from anon;
grant  execute on function public.list_admin_accounts() to authenticated;

-- ---------------------------------------------------------------------------
-- 10. ROLLBACK (commented — not executed by this migration).
--
--     THERE IS NO POINT OF NO RETURN IN THIS MIGRATION. No column is dropped, no row is
--     deleted, no data is moved, and nothing is rewritten in place. Every change is either
--     additive (the table, the five functions) or a grant/policy/trigger swap that restores
--     in one statement. Running the block below returns the database to its pre-apply
--     behaviour — INCLUDING the privilege-escalation hole, so it is an emergency measure and
--     nothing else.
--
--     BEFORE APPLYING, capture the pre-state the GRANT below depends on:
--       select grantee, privilege_type from information_schema.role_table_grants
--        where table_schema='public' and table_name='profiles' order by 1,2;
--
--     begin;
--       drop function if exists public.list_admin_accounts();
--       drop function if exists public.redeem_admin_invite(text);
--       drop function if exists public.revoke_staff_admin(uuid);
--       drop function if exists public.create_admin_invite(text);
--
--       -- guard_profile_role, verbatim from 20260727163720 (definer, UPDATE-only trigger)
--       create or replace function public.guard_profile_role()
--       returns trigger language plpgsql security definer set search_path = '' as $body$
--       begin
--         if new.role is distinct from old.role and not public.is_staff() then
--           raise exception 'only staff may change a profile role';
--         end if;
--         return new;
--       end;
--       $body$;
--       revoke execute on function public.guard_profile_role() from public, anon, authenticated;
--       drop trigger if exists profiles_guard_role on public.profiles;
--       create trigger profiles_guard_role
--         before update on public.profiles
--         for each row execute function public.guard_profile_role();
--
--       -- profiles_staff_all, verbatim from 20260727163720 lines 39-40
--       create policy profiles_staff_all on public.profiles
--         for all to authenticated using (public.is_staff()) with check (public.is_staff());
--
--       -- restore ONLY what the pre-apply snapshot above actually showed
--       grant insert, update, delete on public.profiles to authenticated, anon;
--
--       drop table if exists public.admin_invites;
--       drop function if exists public.is_super_admin();
--     commit;
--
--     pgcrypto is intentionally NOT dropped: it predates this migration.
-- ---------------------------------------------------------------------------
