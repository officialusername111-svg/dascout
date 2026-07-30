-- Phase 4 anchor 2 backstop, panel-hardened (run-p4-admin SS-1/CL-1): a listing must not
-- become publicly visible without its verification trail. Public visibility means status
-- 'live' OR 'sold' -- both are anonymously readable under RLS -- so the guard watches
-- entry into either, on INSERT as well as UPDATE, because staff RLS on listings is ALL
-- and PostgREST reaches the table without the app's transition graph.
--
-- security definer + pinned search_path, matching the throttle_property_requests idiom:
-- the guard's correctness must not depend on the calling staff session's own grants on
-- verification_events, which the next migration narrows to select+insert.
create or replace function public.guard_listing_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  has_title_check boolean;
  has_ground_validation boolean;
begin
  if tg_op = 'INSERT' then
    -- A row born live or sold structurally cannot have verification events (events
    -- foreign-key this row), so there is no legitimate insert-as-public path. The app
    -- always inserts draft.
    if new.status in ('live', 'sold') then
      raise exception
        'Listing % cannot be created directly in status %; create it as draft and verify it.',
        new.id, new.status
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE: sold is publicly visible; the only sanctioned road there is through live.
  -- This deliberately grandfathers the 12 pre-admin live rows (zero events), which must
  -- remain sellable -- do NOT require events on ->sold.
  if new.status = 'sold'
     and old.status is distinct from 'sold'
     and old.status is distinct from 'live' then
    raise exception
      'Listing % can only be marked sold from live (current status: %).',
      new.id, old.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'live' and old.status is distinct from 'live' then
    select exists (
      select 1 from public.verification_events e
       where e.listing_id = new.id
         and e.kind = 'title_check'
    ) into has_title_check;

    select exists (
      select 1 from public.verification_events e
       where e.listing_id = new.id
         and e.kind = 'ground_validation'
    ) into has_ground_validation;

    if not has_title_check or not has_ground_validation then
      raise exception
        'Listing % cannot go live without at least one title_check and one ground_validation verification event.',
        new.id
        using errcode = 'check_violation';
    end if;

    -- Atomic with the flip: the published event is written in the same transaction as
    -- the transition it documents, so a live listing without a matching published row
    -- (or the reverse) cannot happen even under a crash between round-trips.
    -- auth.uid() reads the calling session's JWT claim -- security definer changes the
    -- privilege context, not the request claims -- so the real staff actor is recorded;
    -- null when the platform role applies a migration. Fires on every ->live transition,
    -- including a withdrawn->live relist, so relisting gets its own published row too.
    insert into public.verification_events (listing_id, kind, performed_by)
    values (new.id, 'published', auth.uid());
  end if;

  return new;
end;
$$;

-- Default PUBLIC EXECUTE is revoked for hygiene (repo precedent:
-- restrict_is_staff_execute). A trigger function is not directly callable anyway;
-- grants should still say what we mean.
revoke execute on function public.guard_listing_publish() from public, anon, authenticated;

drop trigger if exists guard_listing_publish on public.listings;
create trigger guard_listing_publish
  before insert or update of status on public.listings
  for each row
  execute function public.guard_listing_publish();
