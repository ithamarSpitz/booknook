begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000009', 'genre-because@example.com');
insert into public.works (id, hardcover_id, original_title) values
  ('90000000-0000-0000-0000-000000000001', 9001, 'Because work 1'),
  ('90000000-0000-0000-0000-000000000002', 9002, 'Because work 2');
insert into public.editions (simania_id, work_id, title) values
  (9001, '90000000-0000-0000-0000-000000000001', 'Because edition 1'),
  (9002, '90000000-0000-0000-0000-000000000002', 'Because edition 2');

create function pg_temp.genre_because_row(p_work integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'work_id', '90000000-0000-0000-0000-' || lpad(p_work::text, 12, '0'),
    'genre', 'Fantasy',
    'shelf_position', 0,
    'position', p_work - 1,
    'simania_id', 9000 + p_work,
    'score', 2.5
  );
$$;

set local role service_role;
select lives_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000009',
  jsonb_build_array(
    pg_temp.genre_because_row(1) || jsonb_build_object('because', jsonb_build_array(17, -4, 29)),
    pg_temp.genre_because_row(2)
  )
), 'because is optional and valid values are accepted');

select is(
  (select because from public.genre_recommendations
    where user_id = '00000000-0000-0000-0000-000000000009'
      and work_id = '90000000-0000-0000-0000-000000000001'),
  array[17, -4, 29],
  'because is stored in the supplied order'
);
select is(
  (select because from public.genre_recommendations
    where user_id = '00000000-0000-0000-0000-000000000009'
      and work_id = '90000000-0000-0000-0000-000000000002'),
  '{}'::integer[],
  'a missing because value stores an empty array'
);

select throws_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000009',
  jsonb_build_array(pg_temp.genre_because_row(1) || '{"because":[1.5]}'::jsonb)
), '22023', 'invalid genre recommendation payload', 'a fractional because element is rejected');
select throws_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000009',
  jsonb_build_array(pg_temp.genre_because_row(1) || '{"because":[null]}'::jsonb)
), '22023', 'invalid genre recommendation payload', 'a null because element is rejected');
select throws_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000009',
  jsonb_build_array(pg_temp.genre_because_row(1) || '{"because":[7,7]}'::jsonb)
), '22023', 'invalid genre recommendation payload', 'a duplicate because element is rejected');
select throws_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000009',
  jsonb_build_array(pg_temp.genre_because_row(1) || '{"because":[0]}'::jsonb)
), '22023', 'invalid genre recommendation payload', 'zero in because is rejected');
select throws_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000009',
  jsonb_build_array(pg_temp.genre_because_row(1) || jsonb_build_object(
    'because', (select jsonb_agg(n) from generate_series(1, 11) n)
  ))
), '22023', 'invalid genre recommendation payload', 'eleven because elements are rejected');
select throws_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000009',
  jsonb_build_array(pg_temp.genre_because_row(1) || '{"because":7}'::jsonb)
), '22023', 'invalid genre recommendation payload', 'a non-array because value is rejected');

reset role;
select * from finish();
rollback;
