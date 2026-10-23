-- Database tests: row-level security + one-title-per-household + own-swipes-only.
-- Paste into Supabase → SQL Editor and run ("Run without RLS" if asked; that
-- only concerns the temp results table). Everything happens in one transaction
-- that ends in an error on purpose, so NOTHING is saved. The error message is
-- the report: every line should start with PASS.

create temp table r(n serial, ok boolean, step text, got text);
grant all on r to authenticated, anon;
grant usage on sequence r_n_seq to authenticated, anon;
create function pg_temp.chk(step text, got text, want text) returns void language sql as
  $$ insert into r(ok, step, got) values (got is not distinct from want, step, coalesce(got, 'NULL')) $$;
grant execute on function pg_temp.chk(text, text, text) to authenticated, anon;

insert into auth.users(id, instance_id, aud, role, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@t.test'),
  ('aaaaaaaa-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@t.test'),
  ('aaaaaaaa-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c@t.test');

-- Alice creates a household and swipes ------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',true);
select pg_temp.chk('before joining: sees no households', (select count(*)::text from households), '0');
do $$ begin perform public.swipe('{"key":"movie:1","title":"X"}', 'yes');
  perform pg_temp.chk('swipe before joining is refused', 'allowed', 'refused');
exception when others then perform pg_temp.chk('swipe before joining is refused', 'refused', 'refused'); end $$;
select public.create_household('Test couch','alice');
select public.swipe('{"key":"movie:27205","media_type":"movie","tmdb_id":27205,"title":"  Inception ","year":2010}', 'yes');
select public.swipe('{"key":"movie:27205","media_type":"movie","title":"Inception","poster":"/p.jpg"}', 'no');
select pg_temp.chk('same key twice → one title', (select count(*)::text from titles), '1');
select pg_temp.chk('title name is cleaned', (select title from titles), 'Inception');
select pg_temp.chk('poster filled in later', (select poster from titles), '/p.jpg');
select pg_temp.chk('swiping again replaces my choice', (select string_agg(choice, ',') from swipes), 'no');
do $$ begin perform public.swipe('{"key":"movie:2","title":"Y"}', 'maybe');
  perform pg_temp.chk('unknown choice is refused', 'allowed', 'refused');
exception when others then perform pg_temp.chk('unknown choice is refused', 'refused', 'refused'); end $$;
select pg_temp.chk('refused swipe left nothing behind', (select count(*)::text from titles), '1');

-- Bob joins and swipes on the same title ----------------------------------
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}',true);
select public.join_household((select join_code from households where name = 'Test couch' limit 1), 'bob');
select pg_temp.chk('bob sees alice''s title', (select count(*)::text from titles), '1');
select public.swipe('{"key":"movie:27205","media_type":"movie","title":"Inception"}', 'yes');
select pg_temp.chk('bob sees both swipes', (select count(*)::text from swipes), '2');
update swipes set choice = 'yes' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from swipes where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.chk('bob can''t change or delete alice''s swipe', (select choice from swipes where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'no');
do $$ begin
  insert into swipes(title_id, user_id, choice) select id, 'aaaaaaaa-0000-0000-0000-000000000001', 'yes' from titles limit 1;
  perform pg_temp.chk('bob can''t swipe as alice', 'allowed', 'refused');
exception when others then perform pg_temp.chk('bob can''t swipe as alice', 'refused', 'refused'); end $$;
do $$ begin delete from titles;
  perform pg_temp.chk('titles can''t be deleted from the app', 'allowed', 'refused');
exception when others then perform pg_temp.chk('titles can''t be deleted from the app', 'refused', 'refused'); end $$;
select set_config('test.tid', (select id::text from titles limit 1), true);

-- Carol is in another household -------------------------------------------
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}',true);
select public.create_household('Elsewhere','carol');
select pg_temp.chk('carol sees no titles from the other household', (select count(*)::text from titles), '0');
select pg_temp.chk('carol sees no swipes from the other household', (select count(*)::text from swipes), '0');
select pg_temp.chk('carol sees only herself', (select string_agg(username, ',') from members), 'carol');
do $$ begin
  insert into swipes(title_id, choice) values (current_setting('test.tid')::uuid, 'yes');
  perform pg_temp.chk('carol can''t swipe on another household''s title', 'allowed', 'refused');
exception when others then perform pg_temp.chk('carol can''t swipe on another household''s title', 'refused', 'refused'); end $$;
select public.swipe('{"key":"movie:27205","media_type":"movie","title":"Inception"}', 'liked');
select pg_temp.chk('same key in carol''s household is her own title', (select count(*)::text from titles), '1');

reset role;
select pg_temp.chk('two households, two Inception rows', (select count(*)::text from public.titles), '2');

-- Report (and roll everything back) ---------------------------------------
do $$ declare msg text; begin
  select string_agg(case when ok then 'PASS ' else 'FAIL ' end || step || case when ok then '' else ' (got ' || got || ')' end, E'\n' order by n) into msg from r;
  raise exception E'\n%', msg;
end $$;
