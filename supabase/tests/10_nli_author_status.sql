begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select ok(
  exists (select 1 from pg_enum e
            join pg_type t on t.oid = e.enumtypid
            join pg_namespace n on n.oid = t.typnamespace
           where n.nspname = 'public' and t.typname = 'resolve_status'
             and e.enumlabel = 'nli_author'),
  'resolve_status contains nli_author');

insert into public.works (id, hardcover_id, original_title) values
  ('70000000-0000-0000-0000-000000000002', 777002, 'NLI author fallback work');
insert into public.editions (simania_id, title, author) values
  (777002, 'מהדורה לא מקושרת', 'מחבר');

select lives_ok(
  $$update public.editions
       set work_id = '70000000-0000-0000-0000-000000000002',
           resolve_status = 'nli_author',
           resolved_at = now()
     where simania_id = 777002 and work_id is null$$,
  'an unlinked edition can be linked with resolve_status nli_author');

select results_eq(
  $$select work_id, resolve_status::text from public.editions where simania_id = 777002$$,
  $$values ('70000000-0000-0000-0000-000000000002'::uuid, 'nli_author'::text)$$,
  'the edition is linked to the work with nli_author');

select * from finish();
rollback;
