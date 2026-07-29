-- Postgres grants EXECUTE on new functions to PUBLIC by default, so revoking it from
-- the anon role alone left the blanket grant in place and /rest/v1/rpc/is_staff kept
-- answering anonymous callers. Drop the default grant, then hand it back to the one
-- role that needs it: the row-level security policies for staff writes evaluate
-- is_staff() with the caller's own privileges.
revoke execute on function public.is_staff() from public;
revoke execute on function public.is_staff() from anon;
grant execute on function public.is_staff() to authenticated;

-- top_listings stays callable by anon on purpose — the public home page ranks on it.
