-- Phase 4 anchor 9: verification_events is the audit trail the brand rests on
-- ("every listing title-checked and boundary-walked"). The Phase 0 policy granted
-- staff ALL (select/insert/update/delete), letting a staff account rewrite or erase
-- what actually happened. Replace it with select+insert only; no update/delete policy
-- exists for this table for any role, so RLS denies both outright.
drop policy if exists verification_events_staff_all on public.verification_events;

create policy verification_events_staff_select
  on public.verification_events
  for select
  to authenticated
  using ((select public.is_staff()));

-- Append-only, self-attributed, app-kind-only, now-stamped (panel-hardened,
-- run-p4-admin SL-1/CL-6/SS-3):
--   * performed_by must equal the caller's own auth.uid() -- without this, any staff
--     account could attribute a title_check to a colleague who never performed it;
--   * kind is limited to the two fieldwork kinds -- 'published' rows come only from the
--     publish guard trigger (whose security-definer insert bypasses RLS), so a
--     publication record cannot be fabricated by a direct API call;
--   * occurred_at must equal now() -- the column default passes (both sides are the
--     transaction timestamp), while any client-supplied backdate or postdate fails,
--     so the trail's timing is DB-asserted, not staff-asserted.
create policy verification_events_staff_insert
  on public.verification_events
  for insert
  to authenticated
  with check (
    (select public.is_staff())
    and performed_by = (select auth.uid())
    and kind in ('title_check', 'ground_validation')
    and occurred_at = now()
  );

-- The audit trail must survive its listing (run-p4-admin SS-2): the FK was
-- ON DELETE CASCADE (verified live), letting one staff DELETE erase a listing and its
-- entire verification history in a single call. RESTRICT makes any listing with
-- recorded events undeletable; an unverified draft (no events) remains deletable
-- cleanup. Table has 0 rows today, so the constraint swap is instant.
alter table public.verification_events
  drop constraint verification_events_listing_id_fkey;
alter table public.verification_events
  add constraint verification_events_listing_id_fkey
  foreign key (listing_id) references public.listings (id) on delete restrict;
