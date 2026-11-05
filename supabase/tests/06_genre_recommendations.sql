begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'genre-a@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'genre-b@example.com');
insert into public.works (id, hardcover_id, original_title)
select ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       n, 'Genre work ' || n
  from generate_series(1, 70) n;
insert into public.editions (simania_id, work_id, title)
select hardcover_id, id, original_title from public.works;

create function pg_temp.genre_row(
  p_work integer,
  p_genre text default 'Fantasy',
  p_shelf_position integer default 0,
  p_position integer default 0,
  p_simania_id integer default null
) returns jsonb language sql as $$
  select jsonb_build_object(
    'work_id', '20000000-0000-0000-0000-' || lpad(p_work::text, 12, '0'),
    'genre', p_genre,
    'shelf_position', p_shelf_position,
    'position', p_position,
    'simania_id', p_simania_id,
    'score', 2.5
  );
$$;

create function pg_temp.genre_payload(p_start integer, p_count integer, p_genre text)
returns jsonb language sql as $$
  select coalesce(jsonb_agg(pg_temp.genre_row(
    n, p_genre, 0, (n - p_start) % 12, n
  ) order by n), '[]'::jsonb)
    from generate_series(p_start, p_start + p_count - 1) n;
$$;

select ok(not has_function_privilege(
  'authenticated', 'public.replace_genre_recommendations(uuid,jsonb)', 'EXECUTE'
), 'authenticated cannot execute replacement RPC');
select ok(has_function_privilege(
  'service_role', 'public.replace_genre_recommendations(uuid,jsonb)', 'EXECUTE'
), 'service role can execute replacement RPC');
select ok(not (select prosecdef from pg_proc
  where oid = 'public.replace_genre_recommendations(uuid,jsonb)'::regprocedure),
  'replacement RPC is security invoker');

set local role service_role;
select lives_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000001',
  jsonb_build_array(
    pg_temp.genre_row(1, 'Fantasy', 0, 0, 1),
    pg_temp.genre_row(2, 'Fantasy', 0, 1, 2)
  )
), 'service role seeds first user rows');
select lives_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000002',
  jsonb_build_array(pg_temp.genre_row(3, 'Mystery', 0, 0, 3))
), 'service role seeds second user row');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*) from public.genre_recommendations), 2::bigint,
  'a user reads only own genre recommendations');
select throws_ok(
  $$insert into public.genre_recommendations
      (user_id, work_id, genre, shelf_position, position, score)
    values (auth.uid(), '20000000-0000-0000-0000-000000000004',
            'Fantasy', 0, 0, 1)$$,
  '42501', 'permission denied for table genre_recommendations',
  'clients cannot insert genre recommendations');
select throws_ok(
  $$update public.genre_recommendations set score = 9 where user_id = auth.uid()$$,
  '42501', 'permission denied for table genre_recommendations',
  'clients cannot update genre recommendations');
select throws_ok(
  $$delete from public.genre_recommendations where user_id = auth.uid()$$,
  '42501', 'permission denied for table genre_recommendations',
  'clients cannot delete genre recommendations');
select throws_ok(
  $$select public.replace_genre_recommendations(
      '00000000-0000-0000-0000-000000000001', '[]')$$,
  '42501', 'permission denied for function replace_genre_recommendations',
  'authenticated cannot invoke replacement RPC');

-- Shelf work 1, then replace the entire first user's set. The replacement must
-- drop both the old work 2 and the now-shelved work 1.
insert into public.shelf_books (user_id, simania_id, shelf_id)
select auth.uid(), 1, id from public.shelves
 where user_id = auth.uid() and kind = 'read';
reset role;
set local role service_role;
select lives_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000001',
  jsonb_build_array(
    pg_temp.genre_row(1, 'Fantasy', 0, 0, 1),
    pg_temp.genre_row(4, 'Fantasy', 0, 1, 4),
    pg_temp.genre_row(5, 'Mystery', 1, 0, null)
  )
), 'replacement succeeds');
select results_eq(
  $$select work_id from public.genre_recommendations
     where user_id = '00000000-0000-0000-0000-000000000001'
     order by work_id$$,
  $$values
    ('20000000-0000-0000-0000-000000000004'::uuid),
    ('20000000-0000-0000-0000-000000000005'::uuid)$$,
  'replacement is whole-set and excludes works on the user shelves');
select is((select count(distinct generated_at) from public.genre_recommendations
  where user_id = '00000000-0000-0000-0000-000000000001'), 1::bigint,
  'one generation timestamp is used');
select is((select count(*) from public.genre_recommendations
  where user_id = '00000000-0000-0000-0000-000000000002'), 1::bigint,
  'replacement leaves another user untouched');

select throws_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000001',
  (select jsonb_agg(pg_temp.genre_row(n, 'Genre ' || n, (n - 1) % 5, 0, n))
     from generate_series(6, 11) n)
), '22023', 'invalid genre recommendation payload', 'a sixth genre is rejected');
select throws_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000001',
  pg_temp.genre_payload(12, 13, 'Fantasy')
), '22023', 'invalid genre recommendation payload', 'a thirteenth row in one genre is rejected');
select throws_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000001',
  jsonb_build_array(pg_temp.genre_row(25), pg_temp.genre_row(25))
), '22023', 'invalid genre recommendation payload', 'duplicate works are rejected');
select throws_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000001',
  jsonb_build_array(pg_temp.genre_row(26, 'Fantasy', 0, 0, 27))
), '22023', 'edition does not belong to work', 'an edition of another work is rejected');
select is((select count(*) from public.genre_recommendations
  where user_id = '00000000-0000-0000-0000-000000000001'), 2::bigint,
  'failed replacements preserve the previous whole set');

select lives_ok($$select public.replace_genre_recommendations(
  '00000000-0000-0000-0000-000000000001', '[]')$$,
  'empty input clears the user rows');
select is((select count(*) from public.genre_recommendations
  where user_id = '00000000-0000-0000-0000-000000000001'), 0::bigint,
  'empty replacement clears the whole set');

reset role;
select * from finish();
rollback;
