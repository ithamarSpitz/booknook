begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'dismiss-a@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'dismiss-b@example.com');
insert into public.works (id, hardcover_id, original_title) values
  ('90000000-0000-0000-0000-000000000001', 990001, 'Backfilled work'),
  ('90000000-0000-0000-0000-000000000002', 990002, 'Dismissed work'),
  ('90000000-0000-0000-0000-000000000003', 990003, 'Private work');
insert into public.recommendations
  (user_id, work_id, score, because, dismissed, generated_at)
values
  ('00000000-0000-0000-0000-0000000000a1',
   '90000000-0000-0000-0000-000000000001', 1, '{}', true,
   timestamptz '2026-11-01 12:00:00+00'),
  ('00000000-0000-0000-0000-0000000000a1',
   '90000000-0000-0000-0000-000000000002', 2, '{}', false, now()),
  ('00000000-0000-0000-0000-0000000000b2',
   '90000000-0000-0000-0000-000000000002', 3, '{}', false, now());
insert into public.genre_recommendations
  (user_id, work_id, genre, shelf_position, position, score)
values
  ('00000000-0000-0000-0000-0000000000a1',
   '90000000-0000-0000-0000-000000000002', 'Fantasy', 0, 0, 2),
  ('00000000-0000-0000-0000-0000000000b2',
   '90000000-0000-0000-0000-000000000002', 'Fantasy', 0, 0, 3);

-- Exercise the migration backfill against a recommendation created after the
-- migration has already been applied by the test database setup.
insert into public.dismissed_works (user_id, work_id, kind, dismissed_at)
select user_id, work_id, 'hide', generated_at
  from public.recommendations
 where dismissed
on conflict (user_id, work_id) do nothing;

select is(
  (select kind from public.dismissed_works
    where user_id = '00000000-0000-0000-0000-0000000000a1'
      and work_id = '90000000-0000-0000-0000-000000000001'),
  'hide', 'backfill stores an existing dismissed recommendation as hide');
select is(
  (select dismissed_at from public.dismissed_works
    where user_id = '00000000-0000-0000-0000-0000000000a1'
      and work_id = '90000000-0000-0000-0000-000000000001'),
  timestamptz '2026-11-01 12:00:00+00',
  'backfill preserves the recommendation generation timestamp');

select ok((select prosecdef from pg_proc
  where oid = 'public.dismiss_work(uuid,text)'::regprocedure),
  'dismiss_work is security definer');
select ok((select prosecdef from pg_proc
  where oid = 'public.restore_work(uuid)'::regprocedure),
  'restore_work is security definer');
select ok(not has_function_privilege(
  'anon', 'public.dismiss_work(uuid,text)', 'EXECUTE'),
  'anon cannot execute dismiss_work');
select ok(has_function_privilege(
  'authenticated', 'public.dismiss_work(uuid,text)', 'EXECUTE'),
  'authenticated can execute dismiss_work');
select ok(not has_function_privilege(
  'anon', 'public.restore_work(uuid)', 'EXECUTE'),
  'anon cannot execute restore_work');
select ok(has_function_privilege(
  'authenticated', 'public.restore_work(uuid)', 'EXECUTE'),
  'authenticated can execute restore_work');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $$select public.dismiss_work(
      '90000000-0000-0000-0000-000000000002', 'hide')$$,
  'dismiss_work accepts hide');
select is(
  (select kind from public.dismissed_works
    where work_id = '90000000-0000-0000-0000-000000000002'),
  'hide', 'hide is stored');
select lives_ok(
  $$select public.dismiss_work(
      '90000000-0000-0000-0000-000000000002', 'not_my_type')$$,
  'dismiss_work accepts not_my_type for an already dismissed work');
select is(
  (select kind from public.dismissed_works
    where work_id = '90000000-0000-0000-0000-000000000002'),
  'not_my_type', 'a second dismissal replaces the kind');

select throws_ok(
  $$select public.dismiss_work(
      '90000000-0000-0000-0000-000000000003', 'other')$$,
  '22023', 'invalid dismissal kind', 'an invalid kind is rejected');
select throws_ok(
  $$select public.dismiss_work(
      'ffffffff-ffff-ffff-ffff-ffffffffffff', 'hide')$$,
  '23503', 'work not found', 'an unknown work is rejected');

select is(
  (select dismissed from public.recommendations
    where user_id = auth.uid()
      and work_id = '90000000-0000-0000-0000-000000000002'),
  true, 'dismiss_work marks this user recommendation dismissed');
select is(
  (select count(*) from public.genre_recommendations
    where user_id = auth.uid()
      and work_id = '90000000-0000-0000-0000-000000000002'),
  0::bigint, 'dismiss_work deletes this user genre recommendation');

reset role;
select is(
  (select dismissed from public.recommendations
    where user_id = '00000000-0000-0000-0000-0000000000b2'
      and work_id = '90000000-0000-0000-0000-000000000002'),
  false, 'dismiss_work leaves another user recommendation untouched');
select is(
  (select count(*) from public.genre_recommendations
    where user_id = '00000000-0000-0000-0000-0000000000b2'
      and work_id = '90000000-0000-0000-0000-000000000002'),
  1::bigint, 'dismiss_work leaves another user genre recommendation untouched');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$select public.restore_work(
      '90000000-0000-0000-0000-000000000002')$$,
  'restore_work restores a dismissed work');
select is(
  (select count(*) from public.dismissed_works
    where work_id = '90000000-0000-0000-0000-000000000002'),
  0::bigint, 'restore_work deletes the dismissed work');
select is(
  (select count(*) from public.recommendations
    where user_id = auth.uid()
      and work_id = '90000000-0000-0000-0000-000000000002'),
  0::bigint, 'restore_work deletes the recommendation');
select lives_ok(
  $$select public.restore_work(
      '90000000-0000-0000-0000-000000000002')$$,
  'restoring twice does nothing');

-- Leave one own row and one other-user row for RLS and table-grant checks.
select lives_ok(
  $$select public.dismiss_work(
      '90000000-0000-0000-0000-000000000003', 'hide')$$,
  'the first user creates a private dismissal');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
select public.dismiss_work('90000000-0000-0000-0000-000000000002', 'hide');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select is((select count(*) from public.dismissed_works), 2::bigint,
  'a client selects only own dismissed works');
select is((select count(*) from public.dismissed_works
  where user_id = '00000000-0000-0000-0000-0000000000b2'), 0::bigint,
  'a client cannot select another user dismissed works');
select throws_ok(
  $$insert into public.dismissed_works (user_id, work_id, kind)
    values (auth.uid(), '90000000-0000-0000-0000-000000000002', 'hide')$$,
  '42501', 'permission denied for table dismissed_works',
  'clients cannot insert dismissed works');
select throws_ok(
  $$update public.dismissed_works set kind = 'not_my_type'
    where user_id = auth.uid()$$,
  '42501', 'permission denied for table dismissed_works',
  'clients cannot update dismissed works');
select throws_ok(
  $$delete from public.dismissed_works where user_id = auth.uid()$$,
  '42501', 'permission denied for table dismissed_works',
  'clients cannot delete dismissed works');
select throws_ok(
  $$update public.recommendations set dismissed = true
    where user_id = auth.uid()$$,
  '42501', 'permission denied for table recommendations',
  'clients cannot update recommendation dismissal directly');

reset role;
select * from finish();
rollback;
