begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000f1', 'positive-editions@example.com');

insert into public.works (id, hardcover_id, original_title) values
  ('80000000-0000-0000-0000-000000000001', 880001, 'Negative recommendation'),
  ('80000000-0000-0000-0000-000000000002', 880002, 'Negative genre recommendation'),
  ('80000000-0000-0000-0000-000000000003', 880003, 'Null recommendation'),
  ('80000000-0000-0000-0000-000000000004', 880004, 'Positive recommendation'),
  ('80000000-0000-0000-0000-000000000005', 880005, 'Null genre recommendation'),
  ('80000000-0000-0000-0000-000000000006', 880006, 'Positive genre recommendation');

insert into public.editions (simania_id, work_id, title) values
  (-880001, '80000000-0000-0000-0000-000000000001', 'English recommendation edition'),
  (-880002, '80000000-0000-0000-0000-000000000002', 'English genre edition'),
  (880004, '80000000-0000-0000-0000-000000000004', 'Hebrew recommendation edition'),
  (880006, '80000000-0000-0000-0000-000000000006', 'Hebrew genre edition');

select throws_ok(
  $$insert into public.recommendations (user_id, work_id, simania_id, score, because)
    values ('00000000-0000-0000-0000-0000000000f1',
            '80000000-0000-0000-0000-000000000001', -880001, 1, '{}')$$,
  '23514',
  'new row for relation "recommendations" violates check constraint "recommendations_simania_id_positive_check"',
  'a recommendation cannot reference a negative English edition');

select throws_ok(
  $$insert into public.genre_recommendations
      (user_id, work_id, genre, shelf_position, position, simania_id, score)
    values ('00000000-0000-0000-0000-0000000000f1',
            '80000000-0000-0000-0000-000000000002',
            'Fantasy', 0, 0, -880002, 1)$$,
  '23514',
  'new row for relation "genre_recommendations" violates check constraint "genre_recommendations_simania_id_positive_check"',
  'a genre recommendation cannot reference a negative English edition');

select lives_ok(
  $$insert into public.recommendations (user_id, work_id, simania_id, score, because)
    values
      ('00000000-0000-0000-0000-0000000000f1',
       '80000000-0000-0000-0000-000000000003', null, 1, '{}'),
      ('00000000-0000-0000-0000-0000000000f1',
       '80000000-0000-0000-0000-000000000004', 880004, 1, '{}')$$,
  'recommendations still accept null and positive edition IDs');

select lives_ok(
  $$insert into public.genre_recommendations
      (user_id, work_id, genre, shelf_position, position, simania_id, score)
    values
      ('00000000-0000-0000-0000-0000000000f1',
       '80000000-0000-0000-0000-000000000005', 'Fantasy', 0, 0, null, 1),
      ('00000000-0000-0000-0000-0000000000f1',
       '80000000-0000-0000-0000-000000000006', 'Fantasy', 0, 1, 880006, 1)$$,
  'genre recommendations still accept null and positive edition IDs');

select lives_ok(
  $$update public.recommendations
       set dismissed = true
     where user_id = '00000000-0000-0000-0000-0000000000f1'
       and work_id = '80000000-0000-0000-0000-000000000003'
       and simania_id is null$$,
  'a recommendation with a null edition ID can still be dismissed');
select is(
  (select dismissed
     from public.recommendations
    where user_id = '00000000-0000-0000-0000-0000000000f1'
      and work_id = '80000000-0000-0000-0000-000000000003'),
  true,
  'the null-edition recommendation remains dismissed');

select * from finish();
rollback;
