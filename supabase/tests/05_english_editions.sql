begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, aud, role, email, encrypted_password, raw_user_meta_data)
values ('00000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated',
        'english@example.com', '', '{"display_name":"English"}');

insert into public.works (id, hardcover_id, original_title) values
  ('40000000-0000-0000-0000-000000000001', 888001, 'English work');
insert into public.editions (simania_id, work_id, resolve_status, resolved_at, title) values
  (-888001, '40000000-0000-0000-0000-000000000001', 'hardcover', now(), 'English edition'),
  (888002, '40000000-0000-0000-0000-000000000001', 'wikidata', now(), 'Hebrew edition');

select is('hardcover'::public.resolve_status::text, 'hardcover',
          'hardcover is a valid resolve_status');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $$insert into public.shelf_books (user_id, simania_id, shelf_id)
    select auth.uid(), -888001, id from public.shelves where user_id = auth.uid() and kind = 'want'$$,
  'a user can shelve an English hardcover edition');
select throws_ok(
  $$insert into public.shelf_books (user_id, simania_id, shelf_id)
    select auth.uid(), 888002, id from public.shelves where user_id = auth.uid() and kind = 'reading'$$,
  '23505', 'work already shelved', 'same-work rule blocks a second edition of the work');

reset role;
select * from finish();
rollback;
