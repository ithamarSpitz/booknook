begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'events@example.com', '', '{}'),
  ('00000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated', 'other@example.com', '', '{}');
insert into public.works (id, hardcover_id, original_title) values
  ('20000000-0000-0000-0000-000000000001', 901, 'Event work one'),
  ('20000000-0000-0000-0000-000000000002', 902, 'Event work two');
insert into public.editions (simania_id, work_id, title) values
  (9001, '20000000-0000-0000-0000-000000000001', 'Event one'),
  (9002, '20000000-0000-0000-0000-000000000002', 'Event two');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.shelf_books (user_id, simania_id, shelf_id)
select auth.uid(), v.id, s.id from (values (9001), (9002)) v(id)
cross join lateral (select id from public.shelves where user_id = auth.uid() and kind = 'reading') s;
select results_eq(
  $$select simania_id, action, to_shelf_kind, to_shelf_name from public.book_events order by id$$,
  $$values (9001, 'added', 'reading', 'קורא עכשיו'), (9002, 'added', 'reading', 'קורא עכשיו')$$,
  'adding books records an added event with the shelf');

select public.move_book(9002, (select id from public.shelves where user_id = auth.uid() and kind = 'reading'), 0);
select is((select count(*) from public.book_events), 2::bigint, 'reordering within a shelf is not an event');

select public.move_book(9001, (select id from public.shelves where user_id = auth.uid() and kind = 'read'), 0);
select results_eq(
  $$select action, from_shelf_kind, to_shelf_kind from public.book_events where simania_id = 9001 order by id$$,
  $$values ('added', null, 'reading'), ('moved', 'reading', 'read')$$,
  'moving to another shelf records from and to shelves');

-- Clients cannot update shelf_books; a rating change comes from server code.
reset role;
update public.shelf_books set rating = 4
  where user_id = '00000000-0000-0000-0000-0000000000e1' and simania_id = 9001;
set local role authenticated;
select is((select rating from public.book_events where action = 'rated'), 4::smallint, 'rating a book records the rating');

select public.remove_book(9001);
select results_eq(
  $$select action, from_shelf_kind, rating from public.book_events where simania_id = 9001 order by id desc limit 1$$,
  $$values ('removed', 'read', 4::smallint)$$,
  'removing a book records where it was removed from');

select throws_ok(
  $$insert into public.book_events (user_id, simania_id, action) values (auth.uid(), 9001, 'added')$$,
  '42501', null, 'clients cannot write events directly');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true);
select is((select count(*) from public.book_events), 0::bigint, 'RLS hides another user events');

reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e1';
select is((select count(*) from public.book_events where user_id = '00000000-0000-0000-0000-0000000000e1'),
          0::bigint, 'deleting the account deletes its history');

select * from finish();
rollback;
