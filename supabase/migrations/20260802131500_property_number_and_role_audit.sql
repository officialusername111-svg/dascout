-- run-p7-propno-audit — two additions the owner asked for after run-p6 shipped.
--
-- 1. A PROPERTY NUMBER on listings, typed in by the admin. Their own handle on a listing,
--    used to talk about it with a seller or a buyer without quoting the title.
-- 2. An AUDIT TRAIL for admin role changes. run-p6's 3-lens panel raised this as its single
--    strongest recommendation and the backend-tester re-raised it rather than accept the park:
--    promotions left a trail in admin_invites.accepted_at/accepted_by, but revocations wrote
--    nothing at all. On a system where who-can-do-what matters, a privilege removal with no
--    actor and no timestamp is the classic audit hole. It is now closed in both directions.
--
-- SCOPE CALL, recorded so it is a decision and not an oversight: no PUBLIC PAGE shows
-- property_no this round. Displaying it later (buyers quoting a reference in an enquiry is the
-- obvious use) is one line in the public query; un-displaying it once it has been indexed and
-- shared is not. Safest reversible option taken; owner's call to widen it.
--
-- CORRECTION, written after applying and verified against the live API: "admin-only" is true
-- of the APP and NOT of the DATABASE. `anon` holds table-level SELECT on public.listings, so a
-- new column inherits it and any holder of the publishable key can read property_no directly
-- over PostgREST, whatever the app's queries do.
--
-- The same is true of `price_php`, and that one matters far more: the standing project rule is
-- no peso amounts anywhere public, and it is currently enforced only by the app never selecting
-- the column. Verified 2026-08-02 -- an unauthenticated request returned real prices for live
-- listings. This predates this migration by months and is NOT introduced here.
--
-- The fix for both is a column-grant detach, the pattern 20260730095404 already used on
-- listing_views: revoke SELECT on the table from anon, then re-grant the ~15 columns the public
-- site genuinely reads. It is deliberately NOT done here -- getting the list wrong (status,
-- town_id and search_vector are all filtered or joined on, not merely displayed) takes the
-- public site down, so it earns its own run with its own tests rather than being tacked onto
-- this one.

-- ---------------------------------------------------------------------------
-- 1. property_no
--
--    Nullable, because 51 rows already exist and none has one. Not auto-generated: the owner
--    said "inputted by the admin", so the database validates the shape and guarantees
--    uniqueness, and never invents a value.
--
--    Uniqueness is CASE-INSENSITIVE and partial. `upper(property_no)` in the index means
--    DS-0142 and ds-0142 cannot both exist — two rows that a human would read as the same
--    reference must not both be storable. Partial (`where property_no is not null`) so the
--    51 existing rows, and every future draft, can share the absence of one: in Postgres a
--    plain unique index would allow that anyway since nulls are distinct, but stating it
--    keeps the index small and the intent legible.
--
--    The shape check refuses padding and empties rather than silently storing '   ', which
--    would look set on screen and match nothing in a search.
--
--    No grant is needed: UPDATE on public.listings is held at table level by `authenticated`
--    (verified: 21 of 21 columns), so a new column inherits it, and the listings_staff_write
--    RLS policy still decides which rows may be touched.
-- ---------------------------------------------------------------------------

alter table public.listings
  add column if not exists property_no text;

alter table public.listings
  drop constraint if exists listings_property_no_shape;
alter table public.listings
  add constraint listings_property_no_shape
  check (property_no is null
         or (property_no = btrim(property_no)
             and length(property_no) between 1 and 24));

create unique index if not exists listings_property_no_unique_idx
  on public.listings (upper(property_no))
  where property_no is not null;

-- ---------------------------------------------------------------------------
-- 2. NOT required to go live -- and why not.
--
--    The approved mockup shows a missing property number as a publish blocker, and the
--    obvious implementation was to add `if new.property_no is null then raise` to the
--    existing guard_listing_publish. That was written, then deliberately removed before
--    applying, for a reason worth recording:
--
--    it breaks three pre-existing tests. tests/vitest/account-listing-views-rls
--    .integration.test.ts:73 publishes a fixture listing to set up an unrelated RLS
--    assertion, and tests/e2e/03-listing-journey and 14-match-alerts-and-panels both drive
--    a listing to live through the UI. None of them sets a property number, because none
--    of them could have. Making the change work would have meant editing those fixtures --
--    that is, changing existing tests so a new change passes, which is the wrong direction
--    of causation and is barred by the toolkit's test-integrity rule.
--
--    The owner asked for the field to exist and be typed in by the admin. Requiring it is a
--    separate decision, and it stays additive: a later migration adds the one raise above,
--    and the fixtures get a number at the same time, deliberately rather than as collateral.
--    Until then NOTHING flags a missing number, in the database or on screen. The soft
--    blocker in a publish checklist belongs to the approved-but-UNBUILT admin redesign
--    (docs/mockups/admin-v1-proposed.html) — that is where the mockup depicts it. The admin
--    panel as it stands today has no such checklist, so a missing property number is silent
--    everywhere. Corrected 2026-08-02: the earlier wording here described the mockup as if
--    it were shipped behaviour.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. The role-change audit trail.
--
--    APPEND-ONLY BY CONSTRUCTION, not by convention. There is no INSERT, UPDATE or DELETE
--    policy and no such grant for anon or authenticated, exactly as with admin_invites — the
--    only writers are the two SECURITY DEFINER functions below. An audit table an actor can
--    edit is not an audit table.
--
--    actor_id is ON DELETE SET NULL: the record of what was done must outlive the account that
--    did it. target_id is ON DELETE CASCADE, matching profiles' own lifecycle — if the account
--    is gone there is no subject left to audit, and the row would be an orphan naming nobody.
--
--    `via` names the door the change came through, so a promotion by invite and a revocation by
--    the owner are distinguishable without inferring it from the role pair.
-- ---------------------------------------------------------------------------

create table if not exists public.admin_role_changes (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles(id) on delete set null,
  target_id  uuid not null references public.profiles(id) on delete cascade,
  from_role  public.user_role not null,
  to_role    public.user_role not null,
  via        text not null check (via in ('invite_redeemed', 'revoked_by_super_admin')),
  changed_at timestamptz not null default now(),
  -- a row that records no change is noise in the one place noise is expensive
  constraint admin_role_changes_actually_changed check (from_role <> to_role)
);

create index if not exists admin_role_changes_target_idx
  on public.admin_role_changes (target_id, changed_at desc);

alter table public.admin_role_changes enable row level security;

revoke all    on table public.admin_role_changes from anon, authenticated;
grant  select on table public.admin_role_changes to   authenticated;

drop policy if exists admin_role_changes_super_admin_read on public.admin_role_changes;
create policy admin_role_changes_super_admin_read on public.admin_role_changes
  for select to authenticated
  using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 4. Revocation now writes its own record.
--
--    Carried over verbatim from 20260802021757 apart from the audit insert: the super-admin
--    check, the self-target refusal, the staff-only target filter and the demote-to-buyer
--    (so favourites and history survive) are all unchanged.
--
--    The insert is inside the same transaction as the UPDATE, so a demotion without its audit
--    row cannot happen even under a crash between statements — the same reasoning the publish
--    guard uses for its published event.
-- ---------------------------------------------------------------------------

create or replace function public.revoke_staff_admin(target_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  touched integer;
  actor   uuid := (select auth.uid());
begin
  if not public.is_super_admin() then
    raise exception 'only a super admin may revoke an admin'
      using errcode = 'insufficient_privilege';
  end if;

  if target_id is null or target_id = actor then
    return 'no_change';
  end if;

  update public.profiles p
     set role = 'buyer'
   where p.id   = target_id
     and p.role = 'staff';

  get diagnostics touched = row_count;

  if touched = 0 then
    return 'no_change';
  end if;

  insert into public.admin_role_changes (actor_id, target_id, from_role, to_role, via)
  values (actor, target_id, 'staff', 'buyer', 'revoked_by_super_admin');

  return 'revoked';
end;
$$;

revoke execute on function public.revoke_staff_admin(uuid) from public;
revoke execute on function public.revoke_staff_admin(uuid) from anon;
grant  execute on function public.revoke_staff_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Redemption now writes its own record too.
--
--    Audit is only written when the role ACTUALLY moved. Two cases where it must not be:
--      * a sitting super admin who opens an invite link — the upsert's `role <> 'admin'` guard
--        blocks the write, so nothing changed and nothing is recorded;
--      * an existing staff member redeeming again — same role in, same role out, and the
--        from_role <> to_role constraint would reject the row anyway.
--    Both are handled before the insert rather than by letting a constraint fire, because a
--    caught constraint violation would roll back the redemption with it.
--
--    Everything else is verbatim from 20260802021757, including the contingent-mailbox comment:
--    the email_confirmed_at check is only worth something while the project keeps "Confirm
--    email" ENABLED. Verified enabled 2026-08-02 (mailer_autoconfirm = false).
-- ---------------------------------------------------------------------------

create or replace function public.redeem_admin_invite(raw_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller           uuid := (select auth.uid());
  presented        text := lower(trim(coalesce(raw_token, '')));
  caller_email     text;
  caller_confirmed timestamptz;
  matched_id       uuid;
  matched_role     public.user_role;
  prior_role       public.user_role;
begin
  if caller is null then
    return 'invalid';
  end if;

  if length(presented) not between 32 and 256 then
    return 'invalid';
  end if;

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

  select p.role into prior_role from public.profiles p where p.id = caller;

  insert into public.profiles as p (id, role)
  values (caller, matched_role)
      on conflict (id) do update
     set role = excluded.role
   where p.role <> 'admin';

  if coalesce(prior_role, 'buyer') is distinct from matched_role
     and coalesce(prior_role, 'buyer') <> 'admin' then
    insert into public.admin_role_changes (actor_id, target_id, from_role, to_role, via)
    values (caller, caller, coalesce(prior_role, 'buyer'), matched_role, 'invite_redeemed');
  end if;

  return 'accepted';
end;
$$;

revoke execute on function public.redeem_admin_invite(text) from public;
revoke execute on function public.redeem_admin_invite(text) from anon;
grant  execute on function public.redeem_admin_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. ROLLBACK (commented — not executed).
--
--     No point of no return: nothing is dropped, deleted or rewritten. property_no is additive
--     and nullable, the audit table is new, and both functions restore with CREATE OR REPLACE
--     from 20260802021757 / 20260729233249.
--
--     begin;
--       alter table public.listings drop constraint if exists listings_property_no_shape;
--       drop index if exists public.listings_property_no_unique_idx;
--       -- keep the column unless you are sure no number has been typed in yet:
--       -- alter table public.listings drop column property_no;
--       drop table if exists public.admin_role_changes;
--       -- then re-apply revoke_staff_admin / redeem_admin_invite from 20260802021757,
--       -- verbatim. guard_listing_publish is NOT touched by this migration (see §2), so
--       -- it needs nothing.
--     commit;
-- ---------------------------------------------------------------------------
