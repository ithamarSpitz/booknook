begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000017', 'genre-control-a@example.com'),
  ('00000000-0000-0000-0000-000000000018', 'genre-control-b@example.com');

create function pg_temp.reader_genre_row(
  p_key text,
  p_position integer,
  p_seed_count integer default 1,
  p_candidate_count integer default 2
) returns jsonb language sql as $$
  select jsonb_build_object(
    'genre_key', p_key,
    'label', 'Label ' || p_key,
    'seed_count', p_seed_count,
    'candidate_count', p_candidate_count,
    'position', p_position
  );
$$;

select has_column('public', 'profiles', 'genre_shelf_count',
  'profiles has genre_shelf_count');
select is((select genre_shelf_count from public.profiles
  where id = '00000000-0000-0000-0000-000000000017'), 10::smallint,
  'genre shelf count defaults to ten');
select has_column('public', 'genre_recommendations', 'genre_key',
  'genre recommendations has genre_key');
select ok((select attnotnull from pg_attribute
  where attrelid = 'public.genre_recommendations'::regclass
    and attname = 'genre_key'),
  'the backfilled genre key column is not null');

select ok(has_function_privilege(
  'authenticated', 'public.set_genre_preference(text,text,text)', 'EXECUTE'),
  'authenticated can set genre preferences');
select ok(not has_function_privilege(
  'anon', 'public.set_genre_preference(text,text,text)', 'EXECUTE'),
  'anonymous users cannot set genre preferences');
select ok(has_function_privilege(
  'authenticated', 'public.set_genre_shelf_count(integer)', 'EXECUTE'),
  'authenticated can set genre shelf count');
select ok(not has_function_privilege(
  'authenticated', 'public.replace_reader_genres(uuid,jsonb)', 'EXECUTE'),
  'authenticated cannot replace reader genres');
select ok(has_function_privilege(
  'service_role', 'public.replace_reader_genres(uuid,jsonb)', 'EXECUTE'),
  'service role can replace reader genres');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000017', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok($$select public.set_genre_preference('fantasy', 'Fantasy', 'pinned')$$,
  'the first pinned genre is accepted');
select lives_ok($$select public.set_genre_preference('mystery', 'Mystery', 'pinned')$$,
  'the second pinned genre is accepted');
select lives_ok($$select public.set_genre_preference('history', 'History', 'pinned')$$,
  'the third pinned genre is accepted');
select results_eq(
  $$select genre_key, pin_order from public.genre_preferences order by pin_order$$,
  $$values ('fantasy', 0), ('mystery', 1), ('history', 2)$$,
  'pinned genres receive orders zero, one and two');

select lives_ok($$select public.set_genre_preference('fantasy', 'Fantasy updated', 'pinned')$$,
  're-pinning a genre succeeds');
select is((select pin_order from public.genre_preferences where genre_key = 'fantasy'),
  0, 're-pinning preserves the original order');
select is((select label from public.genre_preferences where genre_key = 'fantasy'),
  'Fantasy updated', 're-pinning updates the label');

select lives_ok($$select public.set_genre_preference('mystery', 'Mystery', 'hidden')$$,
  'a pinned genre can be hidden');
select is((select pin_order from public.genre_preferences where genre_key = 'mystery'),
  null::integer, 'hiding a genre clears its pin order');
select lives_ok($$select public.set_genre_preference('history', 'History', 'auto')$$,
  'auto removes an explicit preference');
select is((select count(*) from public.genre_preferences where genre_key = 'history'),
  0::bigint, 'auto deletes the preference row');

select throws_ok($$select public.set_genre_preference('fantasy', 'Fantasy', 'bad')$$,
  '22023', 'invalid genre preference', 'an invalid preference state is rejected');
select throws_ok($$select public.set_genre_preference('  ', 'Fantasy', 'pinned')$$,
  '22023', 'invalid genre preference', 'a blank genre key is rejected');
select throws_ok($$select public.set_genre_preference('fantasy', '  ', 'pinned')$$,
  '22023', 'invalid genre preference', 'a blank genre label is rejected');

select public.set_genre_preference('pin-' || n, 'Pin ' || n, 'pinned')
  from generate_series(1, 18) n;
select is((select count(*) from public.genre_preferences where state = 'pinned'),
  19::bigint, 'nineteen genres may be pinned');
select throws_ok($$select public.set_genre_preference('pin-19', 'Pin 19', 'pinned')$$,
  '22023', 'too many pinned genres', 'pinning a twentieth genre is rejected');

select lives_ok($$select public.set_genre_shelf_count(1)$$,
  'one genre shelf is accepted');
select is((select genre_shelf_count from public.profiles where id = auth.uid()),
  1::smallint, 'the lower shelf-count bound is stored');
select lives_ok($$select public.set_genre_shelf_count(20)$$,
  'twenty genre shelves are accepted');
select is((select genre_shelf_count from public.profiles where id = auth.uid()),
  20::smallint, 'the upper shelf-count bound is stored');
select throws_ok($$select public.set_genre_shelf_count(0)$$,
  '22023', 'invalid genre shelf count', 'zero genre shelves is rejected');
select throws_ok($$select public.set_genre_shelf_count(21)$$,
  '22023', 'invalid genre shelf count', 'twenty-one genre shelves is rejected');
select throws_ok($$update public.profiles set genre_shelf_count = 10 where id = auth.uid()$$,
  '42501', 'permission denied for table profiles',
  'clients cannot directly update genre shelf count');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000018', true);
select public.set_genre_preference('other-reader', 'Other reader', 'hidden');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000017', true);
select is((select count(*) from public.genre_preferences
  where user_id = '00000000-0000-0000-0000-000000000018'), 0::bigint,
  'a reader cannot see another reader genre preferences');
select throws_ok($$insert into public.genre_preferences
    (user_id, genre_key, label, state, pin_order)
  values (auth.uid(), 'forbidden', 'Forbidden', 'hidden', null)$$,
  '42501', 'permission denied for table genre_preferences',
  'clients cannot directly write genre preferences');

select throws_ok($$select public.replace_reader_genres(
    '00000000-0000-0000-0000-000000000017', '[]')$$,
  '42501', 'permission denied for function replace_reader_genres',
  'reader genre replacement is service-role only');

reset role;
set local role service_role;
select lives_ok(format(
  'select public.replace_reader_genres(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000017',
  jsonb_build_array(
    pg_temp.reader_genre_row('fantasy', 0),
    pg_temp.reader_genre_row('mystery', 1)
  )
), 'reader genres are initially replaced');
select lives_ok(format(
  'select public.replace_reader_genres(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000018',
  jsonb_build_array(pg_temp.reader_genre_row('other-reader', 0))
), 'another reader genres are seeded');
select lives_ok(format(
  'select public.replace_reader_genres(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000017',
  jsonb_build_array(pg_temp.reader_genre_row('history', 0, 3, 4))
), 'reader genre replacement replaces the whole set');
select results_eq(
  $$select genre_key, seed_count, candidate_count, position
      from public.reader_genres
     where user_id = '00000000-0000-0000-0000-000000000017'$$,
  $$values ('history', 3, 4, 0::smallint)$$,
  'only the replacement reader genre rows remain');

select throws_ok(format(
  'select public.replace_reader_genres(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000017',
  jsonb_build_array(pg_temp.reader_genre_row('bad-extra', 0) || '{"extra":true}'::jsonb)
), '22023', 'invalid reader genre payload', 'an extra reader genre key is rejected');
select throws_ok(format(
  'select public.replace_reader_genres(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000017',
  jsonb_build_array(pg_temp.reader_genre_row('bad-negative', 0, -1, 2))
), '22023', 'invalid reader genre payload', 'a negative reader genre count is rejected');
select throws_ok(format(
  'select public.replace_reader_genres(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000017',
  jsonb_build_array(pg_temp.reader_genre_row('bad-position', 100))
), '22023', 'invalid reader genre payload', 'reader genre position 100 is rejected');
select throws_ok(format(
  'select public.replace_reader_genres(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000017',
  jsonb_build_array(
    pg_temp.reader_genre_row('duplicate-a', 0),
    pg_temp.reader_genre_row('duplicate-b', 0)
  )
), '22023', 'invalid reader genre payload', 'duplicate reader genre positions are rejected');
select throws_ok(format(
  'select public.replace_reader_genres(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000017',
  (select jsonb_agg(pg_temp.reader_genre_row('many-' || n, (n - 1) % 100))
     from generate_series(1, 101) n)
), '22023', 'invalid reader genre payload', 'a 101-row reader genre payload is rejected');
select results_eq(
  $$select genre_key, label, seed_count, candidate_count, position
      from public.reader_genres
     where user_id = '00000000-0000-0000-0000-000000000017'$$,
  $$values ('history', 'Label history', 3, 4, 0::smallint)$$,
  'invalid reader genre replacements change nothing');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000017', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*) from public.reader_genres), 1::bigint,
  'a reader sees only their own reader genres');
select throws_ok($$delete from public.reader_genres where user_id = auth.uid()$$,
  '42501', 'permission denied for table reader_genres',
  'clients cannot directly write reader genres');

reset role;
insert into public.works (id, hardcover_id, original_title)
select ('17000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       17000 + n, 'Genre control work ' || n
  from generate_series(1, 13) n;
insert into public.editions (simania_id, work_id, title)
select hardcover_id, id, original_title from public.works
 where hardcover_id between 17001 and 17013;

-- genre_key exists and is not null (no trigger, no default).
select ok((select attnotnull from pg_attribute
  where attrelid = 'public.genre_recommendations'::regclass
    and attname = 'genre_key' and not attisdropped),
  'genre_key exists and is not null');
select ok((select not atthasdef from pg_attribute
  where attrelid = 'public.genre_recommendations'::regclass
    and attname = 'genre_key' and not attisdropped),
  'genre_key has no default');

create function pg_temp.control_recommendation_row(
  p_work integer,
  p_shelf_position integer default 0,
  p_position integer default 0
) returns jsonb language sql as $$
  select jsonb_build_object(
    'work_id', '17000000-0000-0000-0000-' || lpad(p_work::text, 12, '0'),
    'genre_key', 'fantasy',
    'genre', 'Fantasy',
    'shelf_position', p_shelf_position,
    'position', p_position,
    'simania_id', 17000 + p_work,
    'score', 2.5
  );
$$;

set local role service_role;
select throws_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000017',
  jsonb_build_array(pg_temp.control_recommendation_row(1) - 'genre_key')
), '22023', 'invalid genre recommendation payload', 'a missing genre key is rejected');
select lives_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000017',
  jsonb_build_array(pg_temp.control_recommendation_row(1, 19, 0))
), 'genre shelf position 19 is accepted');
select is((select genre_key from public.genre_recommendations
  where user_id = '00000000-0000-0000-0000-000000000017'),
  'fantasy', 'genre recommendation replacement stores genre_key');
select is((select shelf_position from public.genre_recommendations
  where user_id = '00000000-0000-0000-0000-000000000017'),
  19::smallint, 'genre shelf position 19 is stored');
select throws_ok(format(
  'select public.replace_genre_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000017',
  (select jsonb_agg(pg_temp.control_recommendation_row(n, 0, (n - 1) % 12))
     from generate_series(1, 13) n)
), '22023', 'invalid genre recommendation payload',
  'thirteen recommendations for one genre key are rejected');
select results_eq(
  $$select work_id, genre_key, shelf_position, position
      from public.genre_recommendations
     where user_id = '00000000-0000-0000-0000-000000000017'$$,
  $$values ('17000000-0000-0000-0000-000000000001'::uuid, 'fantasy', 19::smallint, 0::smallint)$$,
  'a failed genre recommendation replacement changes nothing');

reset role;
select * from finish();
rollback;
