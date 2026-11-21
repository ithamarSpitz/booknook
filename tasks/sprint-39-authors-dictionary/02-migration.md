---
id: S39-T2
stage: 2
model_class: worker
timeout_minutes: 20
review: true
allow_protected: true
depends_on:
  - S39-T1
allowed_paths:
  - supabase/migrations/20261122000100_authors.sql
  - supabase/tests/13_authors.sql
  - supabase/functions/_shared/types.ts
context:
  - contract
  - architecture.data_model
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "const fs=require('fs');const m=fs.readFileSync('supabase/migrations/20261122000100_authors.sql','utf8');for(const w of ['create table public.authors','create table public.author_names','enable row level security',\"add value if not exists 'dictionary'\"])if(!m.includes(w))throw new Error('migration '+w);if(!fs.readFileSync('supabase/functions/_shared/types.ts','utf8').includes('\"dictionary\"'))throw new Error('types')"
---

# Goal

Contract: "**Authors table (S39).**" (storage) and the `dictionary` status from "**Dictionary last resort (S39).**".

Docker isn't available on the implementer's machine, so `npm run test:db` runs only in CI. Write the SQL test anyway. The reviewer checks the SQL by reading it.

# Scope

1. New `supabase/migrations/20261122000100_authors.sql`:
   - `alter type public.resolve_status add value if not exists 'dictionary';`
   - `create table public.authors (id uuid primary key default gen_random_uuid(), wikidata_checked_at timestamptz, created_at timestamptz not null default now());`
   - `create table public.author_names (author_id uuid not null references public.authors(id) on delete cascade, lang text not null check (lang in ('en','he')), name text not null, name_key text not null, source text not null check (source in ('link','wikidata')), created_at timestamptz not null default now(), primary key (lang, name_key));`
   - `create index author_names_author_id on public.author_names (author_id);`
   - `alter table ... enable row level security` on both tables, with no policies.
2. New `supabase/tests/13_authors.sql` (pgTAP, in the style of `supabase/tests/12_genre_control.sql`):
   - both tables exist with RLS on;
   - a duplicate `(lang, name_key)` insert fails;
   - deleting an author removes its names;
   - `'dictionary'::public.resolve_status` is valid.
3. `supabase/functions/_shared/types.ts`:
   - `ResolveStatus` gains `"dictionary"`;
   - add `AuthorNameRow { author_id: string; lang: "en" | "he"; name: string; name_key: string; source: "link" | "wikidata" }`.

# Acceptance criteria

1. All verification commands pass. The reviewer confirms the SQL matches the scope exactly.
