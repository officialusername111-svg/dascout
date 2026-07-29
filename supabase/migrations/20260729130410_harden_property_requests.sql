-- Finding 4: the request form is not wired up yet (Phase 5), but the table already
-- accepts anonymous inserts with nothing but an email-format check. Before that form
-- goes live, the table should not be usable as free storage or a spam sink.

alter table public.property_requests
  drop constraint if exists property_requests_field_lengths;
alter table public.property_requests
  add constraint property_requests_field_lengths
  check (
    char_length(email) <= 254
    and (preferred_town is null or char_length(preferred_town) <= 120)
    and (notes is null or char_length(notes) <= 2000)
  );

alter table public.property_requests
  drop constraint if exists property_requests_budget_sane;
alter table public.property_requests
  add constraint property_requests_budget_sane
  check (
    (budget_min is null or budget_min >= 0)
    and (budget_max is null or budget_max >= 0)
    and (budget_min is null or budget_max is null or budget_max >= budget_min)
  );

-- A per-address throttle. It runs as definer because an anonymous caller cannot read
-- the table to count its own rows, and search_path is pinned so the lookup cannot be
-- redirected at a table someone else controls.
create or replace function public.throttle_property_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
begin
  select count(*) into recent
    from public.property_requests r
   where lower(r.email) = lower(new.email)
     and r.created_at > now() - interval '1 hour';

  if recent >= 3 then
    raise exception 'Too many property requests from this email address in the last hour.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists throttle_property_requests on public.property_requests;
create trigger throttle_property_requests
  before insert on public.property_requests
  for each row execute function public.throttle_property_requests();
