-- Finding 5: is_staff() answers a question about the caller's own role. An anonymous
-- caller is never staff, so exposing it on /rest/v1/rpc buys nothing and only widens
-- the surface. top_listings() stays anon-executable: the public home page ranks on it.
revoke execute on function public.is_staff() from anon;

-- Finding 9: the bucket accepted a file of any size and any type. Only staff can write
-- to it today, but Phase 4 opens uploads to that screen, and the limits should already
-- be in place when it does. The largest photo in the bucket today is 143 KB.
update storage.buckets
   set file_size_limit    = 10485760,  -- 10 MB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'listing-photos';
