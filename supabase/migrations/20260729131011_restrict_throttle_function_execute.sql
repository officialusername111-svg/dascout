-- A trigger function has no business being reachable as an RPC endpoint. Postgres
-- checks EXECUTE when the trigger is created, not when it fires, so removing every
-- grant leaves the trigger working while closing /rest/v1/rpc/throttle_property_requests.
revoke execute on function public.throttle_property_requests() from public;
revoke execute on function public.throttle_property_requests() from anon;
revoke execute on function public.throttle_property_requests() from authenticated;
