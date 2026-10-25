begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'rater@example.com', '', '{}'),
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'other-rater@example.com', '', '{}');
insert into public.works (id, hardcover_id, original_title) values
  ('30000000-0000-0000-0000-000000000001', 951, 'Rated work');
insert into public.editions (simania_id, work_id, title) values
  (9501, '30000000-0000-0000-0000-000000000001', 'Rated');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
insert into public.shelf_books (user_id, simania_id, shelf_id)
select auth.uid(), 9501, id from public.shelves where user_id = auth.uid() and kind = 'want';

select lives_ok($$select public.set_rating(9501, 4::smallint)$$, 'a user can rate a book on any shelf');
select is((select rating from public.shelf_books where simania_id = 9501), 4::smallint, 'the rating is stored');
select lives_ok($$select public.set_rating(9501, null)$$, 'a rating can be cleared');
select is((select rating from public.shelf_books where simania_id = 9501), null, 'cleared rating is null');
select throws_ok($$select public.set_rating(9501, 6::smallint)$$, '22023', 'rating must be 1 to 5', 'out-of-range rating is rejected');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
select throws_ok($$select public.set_rating(9501, 5::smallint)$$, 'P0002', 'book not found', 'a user cannot rate another user book');

select * from finish();
rollback;
