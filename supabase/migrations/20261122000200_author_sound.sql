alter table public.author_names
  drop constraint author_names_source_check,
  add constraint author_names_source_check check (source in ('link','wikidata','sound'));

alter table public.authors
  add column sound_checked_at timestamptz;
