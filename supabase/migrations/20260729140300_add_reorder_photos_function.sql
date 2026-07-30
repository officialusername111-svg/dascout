-- Phase 4 verify-fix cycle 2 (run-p4-admin, AC-16): the app-side reorder issued five
-- sequential round trips (clear primaries -> N order writes -> set primary), which on the
-- hosted database is an observable torn state -- a reader mid-sequence sees no cover and
-- stale orders, and a click computed from that torn read writes a wrong order (measured,
-- not theorised). One SECURITY INVOKER function makes the whole rewrite a single
-- transaction: observers see either the old order or the new one, never the middle.
--
-- INVOKER on purpose: RLS on listing_photos still governs the writes -- a non-staff
-- caller's UPDATE matches zero rows, and the function reports the true row count so the
-- caller can tell. This is the deliberate opposite of the guard trigger's DEFINER: that
-- one enforces policy, this one merely batches staff writes.
create or replace function public.reorder_listing_photos(p_listing_id uuid, p_photo_ids uuid[])
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected int;
  supplied int := coalesce(array_length(p_photo_ids, 1), 0);
  written  int;
begin
  select count(*) into expected
    from public.listing_photos
   where listing_id = p_listing_id;

  -- Id-set equality guard (frozen contract): the submitted set must be exactly the
  -- listing's current photos -- a photo added or deleted in another tab means the caller
  -- is reordering a list that no longer exists. -1 maps to the app's 'conflict'.
  if supplied <> expected or exists (
    select 1 from unnest(p_photo_ids) as pid
    where not exists (
      select 1 from public.listing_photos lp
       where lp.id = pid and lp.listing_id = p_listing_id
    )
  ) then
    return -1;
  end if;

  -- Two statements, one transaction: clearing first keeps the partial unique index
  -- (one primary per listing) happy regardless of row order; no observer ever sees
  -- the intermediate state.
  update public.listing_photos
     set is_primary = false
   where listing_id = p_listing_id
     and is_primary;

  update public.listing_photos lp
     set sort_order = u.ord - 1,
         is_primary = (u.ord = 1)
    from unnest(p_photo_ids) with ordinality as u(pid, ord)
   where lp.id = u.pid
     and lp.listing_id = p_listing_id;

  get diagnostics written = row_count;
  return written;
end;
$$;

-- anon has no business here; authenticated keeps EXECUTE because RLS (not the grant)
-- is the write gate -- same posture as the table itself.
revoke execute on function public.reorder_listing_photos(uuid, uuid[]) from public, anon;
