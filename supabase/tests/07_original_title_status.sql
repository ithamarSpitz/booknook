begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select ok(
  exists (select 1 from pg_enum e
            join pg_type t on t.oid = e.enumtypid
            join pg_namespace n on n.oid = t.typnamespace
           where n.nspname = 'public' and t.typname = 'resolve_status'
             and e.enumlabel = 'original_title'),
  'resolve_status contains original_title');

insert into public.works (id, hardcover_id, original_title) values
  ('70000000-0000-0000-0000-000000000001', 777001, 'Original title work');
insert into public.editions (simania_id, title, author) values
  (777001, 'מהדורה לא מקושרת', 'מחבר');

select lives_ok(
  $$update public.editions
       set work_id = '70000000-0000-0000-0000-000000000001',
           resolve_status = 'original_title',
           resolved_at = now()
     where simania_id = 777001 and work_id is null$$,
  'an unlinked edition can be linked with resolve_status original_title');

select results_eq(
  $$select work_id, resolve_status::text from public.editions where simania_id = 777001$$,
  $$values ('70000000-0000-0000-0000-000000000001'::uuid, 'original_title'::text)$$,
  'the edition is linked to the work with original_title');

select * from finish();
rollback;
