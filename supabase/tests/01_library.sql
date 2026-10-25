begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

insert into auth.users (id, aud, role, email, encrypted_password, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'alice@example.com', '', '{"display_name":"Alice"}'),
  ('00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'bob@example.com', '', '{}');

select is((select display_name from public.profiles where id = '00000000-0000-0000-0000-000000000001'),
          'Alice', 'sign-up uses a non-empty metadata display name');
select is((select display_name from public.profiles where id = '00000000-0000-0000-0000-000000000002'),
          'bob', 'sign-up falls back to the email local part');
select results_eq(
  $$select position, name, kind::text from public.shelves
    where user_id = '00000000-0000-0000-0000-000000000001' order by position$$,
  $$values (0, 'קורא עכשיו', 'reading'), (1, 'קראתי', 'read'),
           (2, 'רוצה לקרוא', 'want'), (3, 'הפסקתי', 'stopped')$$,
  'sign-up creates the four default shelves in contract order');

insert into public.works (id, hardcover_id, original_title) values
  ('10000000-0000-0000-0000-000000000001', 1, 'Work one'),
  ('10000000-0000-0000-0000-000000000002', 2, 'Work two'),
  ('10000000-0000-0000-0000-000000000003', 3, 'Work three'),
  ('10000000-0000-0000-0000-000000000004', 4, 'Work four'),
  ('10000000-0000-0000-0000-000000000005', 5, 'Work five'),
  ('10000000-0000-0000-0000-000000000006', 6, 'Work six'),
  ('10000000-0000-0000-0000-000000000007', 7, 'Recommendation A'),
  ('10000000-0000-0000-0000-000000000008', 8, 'Recommendation B');
insert into public.editions (simania_id, work_id, title) values
  (101, '10000000-0000-0000-0000-000000000001', 'One'),
  (102, '10000000-0000-0000-0000-000000000002', 'Two'),
  (103, '10000000-0000-0000-0000-000000000003', 'Three'),
  (104, '10000000-0000-0000-0000-000000000004', 'Four'),
  (105, '10000000-0000-0000-0000-000000000005', 'Five'),
  (106, '10000000-0000-0000-0000-000000000006', 'Six');
insert into public.recommendations (user_id, work_id, score, because) values
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007', 1, '{}'),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000008', 2, '{}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is((select count(*) from public.profiles), 1::bigint, 'RLS hides another user profile');
select is((select count(*) from public.shelves where user_id = '00000000-0000-0000-0000-000000000002'),
          0::bigint, 'RLS hides another user shelves');
select is((select count(*) from public.recommendations), 1::bigint, 'RLS hides another user recommendations');

update public.profiles set display_name = 'Changed' where id = '00000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is((select display_name from public.profiles where id = auth.uid()),
          'bob', 'RLS prevents updating another user profile');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
-- Bob needs a custom shelf: clients may update name only on custom rows, so a
-- built-in-only UPDATE would match zero rows even without user_id = auth.uid().
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
insert into public.shelves (user_id, name, kind, position)
values (auth.uid(), 'Bob Custom', 'custom', 99);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
update public.shelves set name = 'Changed' where user_id = '00000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is((select name from public.shelves where kind = 'custom'),
          'Bob Custom', 'RLS prevents updating another user shelves');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
update public.recommendations set dismissed = true
 where user_id = '00000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is((select dismissed from public.recommendations where user_id = auth.uid()),
          false, 'RLS prevents updating another user recommendation');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

select throws_ok($$delete from public.profiles where id = '00000000-0000-0000-0000-000000000002'$$,
                 '42501', 'permission denied for table profiles', 'clients cannot delete profiles');
select throws_ok($$delete from public.shelves where user_id = '00000000-0000-0000-0000-000000000002'$$,
                 '42501', 'permission denied for table shelves', 'clients cannot directly delete shelves');
select throws_ok($$delete from public.shelf_books where user_id = '00000000-0000-0000-0000-000000000002'$$,
                 '42501', 'permission denied for table shelf_books', 'clients cannot directly delete shelf books');
select throws_ok($$delete from public.recommendations where user_id = '00000000-0000-0000-0000-000000000002'$$,
                 '42501', 'permission denied for table recommendations', 'clients cannot delete recommendations');

select throws_ok($$insert into public.works (original_title) values ('Forbidden')$$,
                 '42501', 'permission denied for table works', 'clients cannot write works');
select throws_ok($$insert into public.editions (simania_id, title) values (999, 'Forbidden')$$,
                 '42501', 'permission denied for table editions', 'clients cannot write editions');
select throws_ok($$insert into public.search_cache (query_norm, results) values ('x', '[]')$$,
                 '42501', 'permission denied for table search_cache', 'clients cannot write search cache');
select throws_ok($$update public.profiles set created_at = now() where id = auth.uid()$$,
                 '42501', 'permission denied for table profiles',
                 'profile clients can update only display name and locale');

select throws_ok(
  $$insert into public.shelves (user_id, name, kind, position)
    values (auth.uid(), 'Not custom', 'reading', 99)$$,
  '42501', 'new row violates row-level security policy for table "shelves"',
  'clients cannot insert non-custom shelves');
select lives_ok(
  $$insert into public.shelves (user_id, name, kind, position)
    values (auth.uid(), 'Custom', 'custom', 99)$$,
  'clients can insert custom shelves');
select is((select position from public.shelves where user_id = auth.uid() and name = 'Custom'),
          4, 'custom shelf creation appends and overrides supplied position');
update public.shelves set name = 'Built-in changed'
 where user_id = auth.uid() and kind = 'reading';
select is((select name from public.shelves where user_id = auth.uid() and kind = 'reading'),
          'קורא עכשיו', 'clients cannot rename a built-in shelf');
select throws_ok(
  $$select public.delete_shelf((select id from public.shelves where user_id = auth.uid() and kind = 'reading'))$$,
  '22023', 'default shelves cannot be deleted', 'delete_shelf rejects a default shelf');

insert into public.shelf_books (user_id, simania_id, shelf_id)
select auth.uid(), v.simania_id, s.id
from (values (101), (102), (103)) v(simania_id)
cross join lateral (select id from public.shelves where user_id = auth.uid() and kind = 'reading') s;
insert into public.shelf_books (user_id, simania_id, shelf_id)
select auth.uid(), 104, id from public.shelves where user_id = auth.uid() and kind = 'want';
insert into public.shelf_books (user_id, simania_id, shelf_id)
select auth.uid(), v.simania_id, s.id
from (values (105), (106)) v(simania_id)
cross join lateral (select id from public.shelves where user_id = auth.uid() and kind = 'custom') s;

select results_eq(
  $$select sb.simania_id, sb.position from public.shelf_books sb join public.shelves s on s.id = sb.shelf_id
    where s.kind = 'reading' order by sb.position$$,
  $$values (101,0), (102,1), (103,2)$$, 'book inserts append gaplessly');
select throws_ok(
  $$insert into public.shelf_books (user_id, simania_id, shelf_id)
    select auth.uid(), 105, id from public.shelves where user_id = auth.uid() and kind = 'want'$$,
  '23505', 'edition already shelved', 'one edition cannot sit on two shelves for a user');

select lives_ok(
  $$select public.move_book(103, (select id from public.shelves where user_id = auth.uid() and kind = 'reading'), 0)$$,
  'move_book supports a same-shelf move');
select results_eq(
  $$select sb.simania_id, sb.position from public.shelf_books sb join public.shelves s on s.id = sb.shelf_id
    where s.kind = 'reading' order by sb.position$$,
  $$values (103,0), (101,1), (102,2)$$, 'same-shelf move preserves gapless stable order');
select is((select finished_at from public.shelf_books where user_id = auth.uid() and simania_id = 103),
          null::timestamptz, 'finished_at stays unset until the book first reaches read');
select lives_ok(
  $$select public.move_book(103, (select id from public.shelves where user_id = auth.uid() and kind = 'read'), 0)$$,
  'move_book supports a cross-shelf move');
select results_eq(
  $$select sb.simania_id, sb.position from public.shelf_books sb join public.shelves s on s.id = sb.shelf_id
    where s.kind = 'reading' order by sb.position$$,
  $$values (101,0), (102,1)$$, 'cross-shelf move closes the source gap');
select is((select finished_at from public.shelf_books where user_id = auth.uid() and simania_id = 103),
          now(), 'first arrival on read sets finished_at');
-- Stamp a sentinel distinct from transaction-stable now() so a later overwrite
-- with now(), or a clear-then-rewrite, cannot masquerade as preservation.
reset role;
update public.shelf_books
   set finished_at = timestamptz '2000-01-01 00:00:00+00'
 where user_id = '00000000-0000-0000-0000-000000000001' and simania_id = 103;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.move_book(103, (select id from public.shelves where user_id = auth.uid() and kind = 'want'), 1);
select is((select finished_at from public.shelf_books where user_id = auth.uid() and simania_id = 103),
          timestamptz '2000-01-01 00:00:00+00',
          'moving off read does not clear finished_at');
select public.move_book(103, (select id from public.shelves where user_id = auth.uid() and kind = 'read'), 0);
select is((select finished_at from public.shelf_books where user_id = auth.uid() and simania_id = 103),
          timestamptz '2000-01-01 00:00:00+00',
          'later arrival on read preserves finished_at');
select throws_ok(
  $$select public.move_book(103, (select id from public.shelves where user_id = auth.uid() and kind = 'read'), 1)$$,
  '22023', 'invalid book position', 'same-shelf move rejects an out-of-range position');

select lives_ok(
  $$select public.move_shelf((select id from public.shelves where user_id = auth.uid() and kind = 'custom'), 0)$$,
  'move_shelf reorders a shelf');
select results_eq(
  $$select kind::text, position from public.shelves where user_id = auth.uid() order by position$$,
  $$values ('custom', 0), ('reading', 1), ('read', 2), ('want', 3), ('stopped', 4)$$,
  'move_shelf places the custom shelf at position 0 and leaves gapless positions');
select lives_ok(
  $$select public.delete_shelf((select id from public.shelves where user_id = auth.uid() and kind = 'custom'))$$,
  'delete_shelf deletes a custom shelf');
select results_eq(
  $$select sb.simania_id, sb.position from public.shelf_books sb join public.shelves s on s.id = sb.shelf_id
    where s.kind = 'want' order by sb.position$$,
  $$values (104,0), (105,1), (106,2)$$,
  'delete_shelf appends its books in order to want');
select results_eq(
  $$select position from public.shelves where user_id = auth.uid() order by position$$,
  $$values (0), (1), (2), (3)$$, 'delete_shelf closes the shelf gap');
select lives_ok($$select public.remove_book(104)$$, 'remove_book removes an owned book');
select results_eq(
  $$select sb.simania_id, sb.position from public.shelf_books sb join public.shelves s on s.id = sb.shelf_id
    where s.kind = 'want' order by sb.position$$,
  $$values (105,0), (106,1)$$, 'remove_book closes the book gap');

select lives_ok(
  $$update public.recommendations set dismissed = true
    where user_id = auth.uid() and work_id = '10000000-0000-0000-0000-000000000007'$$,
  'a user can update dismissed on an owned recommendation');
select throws_ok(
  $$update public.recommendations set score = 9
    where user_id = auth.uid() and work_id = '10000000-0000-0000-0000-000000000007'$$,
  '42501', 'permission denied for table recommendations',
  'a recommendation client cannot update score');
select throws_ok(
  $$update public.recommendations set dismissed = false
    where user_id = auth.uid() and work_id = '10000000-0000-0000-0000-000000000007'$$,
  '22023', 'dismissal is permanent', 'a dismissed recommendation cannot be restored');

-- Create one Bob book as Bob, then verify Alice cannot see it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
insert into public.shelf_books (user_id, simania_id, shelf_id)
select auth.uid(), 106, id from public.shelves where user_id = auth.uid() and kind = 'reading';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.shelf_books where user_id = '00000000-0000-0000-0000-000000000002'),
          0::bigint, 'RLS hides another user shelf books');
select throws_ok(
  $$update public.shelf_books set position = 9
    where user_id = '00000000-0000-0000-0000-000000000002'$$,
  '42501', 'permission denied for table shelf_books',
  'clients cannot update another user shelf books');

reset role;
select * from finish();
rollback;
