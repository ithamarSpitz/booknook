begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'authors', 'authors table exists');
select has_table('public', 'author_names', 'author_names table exists');
select ok((select relrowsecurity from pg_class
  where oid = 'public.authors'::regclass), 'authors has RLS enabled');
select ok((select relrowsecurity from pg_class
  where oid = 'public.author_names'::regclass), 'author_names has RLS enabled');

insert into public.authors (id)
values ('39000000-0000-0000-0000-000000000001');
insert into public.author_names (author_id, lang, name, name_key, source)
values ('39000000-0000-0000-0000-000000000001', 'en', 'Isaac Asimov', 'isaac asimov', 'link'),
       ('39000000-0000-0000-0000-000000000001', 'he', 'אייזק אסימוב', 'אייזק אסימוב', 'wikidata');

select throws_ok($$insert into public.author_names
    (author_id, lang, name, name_key, source)
  values ('39000000-0000-0000-0000-000000000001', 'en', 'Isaac Asimov', 'isaac asimov', 'link')$$,
  '23505', null, 'a duplicate (lang, name_key) is rejected');

select is((select count(*) from public.author_names
  where author_id = '39000000-0000-0000-0000-000000000001'), 2::bigint,
  'the author has two names');
delete from public.authors where id = '39000000-0000-0000-0000-000000000001';
select is((select count(*) from public.author_names
  where author_id = '39000000-0000-0000-0000-000000000001'), 0::bigint,
  'deleting an author removes its names');

select lives_ok($$select 'dictionary'::public.resolve_status$$,
  'dictionary is a valid resolve_status');

select * from finish();
rollback;
