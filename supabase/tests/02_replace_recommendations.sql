begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'replacement-a@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'replacement-b@example.com');
insert into public.works (id, hardcover_id, original_title)
select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, n, 'Work ' || n
from generate_series(1, 5) n;
insert into public.editions (simania_id, work_id, title)
select hardcover_id, id, original_title from public.works;

-- A real client insert exercises the profile-locking add path.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
insert into public.shelf_books (user_id, simania_id, shelf_id)
select auth.uid(), 1, id from public.shelves where user_id = auth.uid() and kind = 'read';
reset role;
insert into public.recommendations (user_id, work_id, score, because, dismissed)
values
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 1, '{}', true),
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 1, '{}', false),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000005', 1, '{}', false);

select ok(not has_function_privilege('anon', 'public.replace_recommendations(uuid,jsonb)', 'EXECUTE'), 'anon cannot replace');
select ok(not has_function_privilege('authenticated', 'public.replace_recommendations(uuid,jsonb)', 'EXECUTE'), 'clients cannot replace');
select ok(has_function_privilege('service_role', 'public.replace_recommendations(uuid,jsonb)', 'EXECUTE'), 'service can replace');
select ok(not (select prosecdef from pg_proc where oid = 'public.replace_recommendations(uuid,jsonb)'::regprocedure), 'RPC is security invoker');

create function pg_temp.payload(ids integer[]) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'work_id', ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0')),
    'simania_id', case when n = 4 then null else n end,
    'score', 2, 'because', array[1], 'shared_tags', array['fantasy'])), '[]'::jsonb)
  from unnest(ids) n;
$$;
set local role service_role;
select results_eq(
  $$select work_id from public.replace_recommendations('00000000-0000-0000-0000-000000000001', pg_temp.payload(array[4,2,1,3]))$$,
  $$values ('10000000-0000-0000-0000-000000000003'::uuid), ('10000000-0000-0000-0000-000000000004'::uuid)$$,
  'replacement excludes shelved/dismissed works and orders ties by Hardcover ID');
select is((select count(distinct generated_at) from public.recommendations where not dismissed and user_id = '00000000-0000-0000-0000-000000000001'), 1::bigint, 'one generation timestamp');
select is((select simania_id from public.recommendations where work_id = '10000000-0000-0000-0000-000000000004'), null::integer, 'English-only row persists');
select is((select count(*) from public.recommendations where user_id = '00000000-0000-0000-0000-000000000002'), 1::bigint, 'other user remains untouched');

select throws_ok($$select public.replace_recommendations('00000000-0000-0000-0000-000000000001', pg_temp.payload(array[3,3]))$$,
  '22023', 'invalid recommendation payload', 'duplicate works rejected');
select throws_ok($$select public.replace_recommendations('00000000-0000-0000-0000-000000000001', jsonb_set(pg_temp.payload(array[3]), '{0,simania_id}', '2'))$$,
  '22023', 'edition does not belong to work', 'mismatched edition rejected');
select throws_ok($$select public.replace_recommendations('00000000-0000-0000-0000-000000000001', pg_temp.payload(array[99]))$$,
  '23503', 'catalog reference not found', 'missing catalog reference rejected');
select throws_ok($$select public.replace_recommendations('00000000-0000-0000-0000-000000000099', '[]')$$,
  '23503', 'profile not found', 'missing user rejected');

-- Each malformed shape must fail without replacing the existing set.
select throws_ok(format('select public.replace_recommendations(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000001', payload),
  '22023', 'invalid recommendation payload', label)
from (values
  ('null'::jsonb, 'JSON null rejected'),
  ('{}'::jsonb, 'non-array rejected'),
  ('[null]'::jsonb, 'non-object row rejected'),
  (pg_temp.payload(array[3]) #- '{0,score}', 'missing field rejected'),
  (jsonb_set(pg_temp.payload(array[3]), '{0,extra}', 'true'), 'extra field rejected'),
  (jsonb_set(pg_temp.payload(array[3]), '{0,score}', '"NaN"'), 'non-finite score rejected'),
  (jsonb_set(pg_temp.payload(array[3]), '{0,score}', '1e100'), 'score overflow rejected'),
  (jsonb_set(pg_temp.payload(array[3]), '{0,because}', '[1.5]'), 'fractional seed rejected'),
  (jsonb_set(pg_temp.payload(array[3]), '{0,because}', '[null]'), 'null seed rejected'),
  (jsonb_set(pg_temp.payload(array[3]), '{0,shared_tags}', '[1]'), 'non-string tag rejected'),
  (pg_temp.payload(array_fill(3, array[21])), 'more than 20 rows rejected')
) cases(payload, label);
select is((select count(*) from public.recommendations where user_id = '00000000-0000-0000-0000-000000000001'), 3::bigint, 'failed replacements preserve previous rows');

-- Addition after generation removes the matching non-dismissed recommendation.
reset role;
set local role authenticated;
insert into public.shelf_books (user_id, simania_id, shelf_id)
select auth.uid(), 3, id from public.shelves where user_id = auth.uid() and kind = 'want';
select is((select count(*) from public.recommendations where work_id = '10000000-0000-0000-0000-000000000003'), 0::bigint, 'addition removes generated recommendation');
reset role;
set local role service_role;
select is((select count(*) from public.replace_recommendations('00000000-0000-0000-0000-000000000001', '[]')), 0::bigint, 'empty input returns no rows');
select results_eq($$select dismissed from public.recommendations where user_id = '00000000-0000-0000-0000-000000000001'$$,
  $$values (true)$$, 'empty input retains only permanent dismissal');
reset role;
select * from finish();
rollback;
