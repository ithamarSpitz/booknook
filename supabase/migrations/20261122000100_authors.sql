alter type public.resolve_status add value if not exists 'dictionary';

create table public.authors (
  id uuid primary key default gen_random_uuid(),
  wikidata_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.author_names (
  author_id uuid not null references public.authors(id) on delete cascade,
  lang text not null check (lang in ('en','he')),
  name text not null,
  name_key text not null,
  source text not null check (source in ('link','wikidata')),
  created_at timestamptz not null default now(),
  primary key (lang, name_key)
);

create index author_names_author_id on public.author_names (author_id);

alter table public.authors enable row level security;
alter table public.author_names enable row level security;
