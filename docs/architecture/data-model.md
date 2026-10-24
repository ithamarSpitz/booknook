# Data model

All tables live in `public`. Timestamps are `timestamptz default now()`. The contract (`docs/contract.md`) may refine column details, but not drop tables or change ownership rules.

## Enums

- `shelf_kind`: `reading`, `read`, `want`, `stopped`, `custom`
- `resolve_status`: `pending`, `wikidata`, `nli`, `fuzzy`, `llm`, `not_found`

## profiles

| column | type | note |
|---|---|---|
| id | uuid PK, references auth.users on delete cascade | |
| display_name | text not null default '' | shown as "הספרייה של {name}" |
| locale | text not null default 'he' | |
| created_at | timestamptz | |

RLS: select and update where `id = auth.uid()`; clients may update only `display_name` and `locale` (column-level grant). No insert or delete from clients.

## works

| column | type | note |
|---|---|---|
| id | uuid PK default gen_random_uuid() | |
| hardcover_id | int unique, nullable | |
| original_title | text not null | |
| original_authors | text[] not null default '{}' | |
| similar_ids | int[] not null default '{}' | Hardcover `cached_similar_book_ids` |
| tags | jsonb not null default '{}' | Hardcover `cached_tags` |
| hardcover_cover_url | text | |
| refreshed_at | timestamptz | |

RLS: select for `authenticated`. No client writes.

## editions

| column | type | note |
|---|---|---|
| simania_id | int PK | |
| work_id | uuid references works, nullable | null until resolved, or when not on Hardcover |
| resolve_status | resolve_status not null default 'pending' | |
| resolved_at | timestamptz | |
| title | text not null | |
| author | text | |
| translator, publisher, series, category | text | |
| year, pages | int | |
| description | text | |
| cover_url | text | |
| simania_rating | numeric(3,2) | |
| simania_rating_count | int | |
| details_at | timestamptz | when details were last fetched |

Index on `work_id`. RLS: select for `authenticated`. No client writes.

## shelves

| column | type | note |
|---|---|---|
| id | uuid PK | |
| user_id | uuid not null references auth.users on delete cascade | |
| name | text not null | |
| kind | shelf_kind not null default 'custom' | |
| position | int not null | |
| created_at | timestamptz | |

Unique `(user_id, position)` deferrable initially deferred. A user has exactly one shelf of each non-custom kind (partial unique index on `(user_id, kind) where kind <> 'custom'`). Non-custom shelves cannot be deleted.

RLS: all operations where `user_id = auth.uid()`; insert only with `kind = 'custom'`.

## shelf_books

| column | type | note |
|---|---|---|
| user_id | uuid not null references auth.users on delete cascade | |
| simania_id | int not null references editions | |
| shelf_id | uuid not null references shelves on delete cascade | |
| position | int not null | |
| added_at | timestamptz | |
| finished_at | timestamptz | set when the book first lands on a `read` shelf |
| rating | smallint check (rating between 1 and 5) | deferred, unused |

PK `(user_id, simania_id)`: a book sits on one shelf. One work per user is enforced by `add-book` (409 when another edition of the same work is already shelved), not by a constraint, because `work_id` can be resolved after the book is shelved. A later resolution that creates such a duplicate is tolerated; recommendations exclude by work either way. Unique `(shelf_id, position)` deferrable initially deferred. A check or trigger guarantees `shelf_id` belongs to `user_id`.

Deleting a custom shelf: its books move to the end of the `want` shelf (handled by the `delete_shelf` RPC).

RLS: all operations where `user_id = auth.uid()`.

## recommendations

| column | type | note |
|---|---|---|
| user_id | uuid references auth.users on delete cascade | PK with work_id |
| work_id | uuid references works | |
| simania_id | int references editions, nullable | null when only an English version exists |
| score | real not null | |
| because | int[] not null | simania_ids of the seed books |
| shared_tags | text[] not null default '{}' | |
| dismissed | boolean not null default false | |
| generated_at | timestamptz | |

RLS: select where `user_id = auth.uid()`; update only of `dismissed` (column-level grant or trigger). Rows written by the function with the service role.

## search_cache

| column | type | note |
|---|---|---|
| query_norm | text PK | |
| results | jsonb not null | |
| fetched_at | timestamptz | TTL 24 hours |

RLS enabled with no policies (service role only).

## Functions and triggers

- `handle_new_user()` trigger on `auth.users` insert: creates the profile (display_name from `raw_user_meta_data->>'display_name'`, else the email local part) and the four default shelves in order: קורא עכשיו (reading), קראתי (read), רוצה לקרוא (want), הפסקתי (stopped).
- `move_book(p_simania_id int, p_to_shelf uuid, p_to_position int)` RPC, `security invoker`: moves one of the caller's books, renumbers positions in both shelves without gaps, sets `finished_at` the first time it lands on a `read` shelf.
- `move_shelf(p_shelf_id uuid, p_to_position int)` RPC: reorders the caller's shelves without gaps.
- `delete_shelf(p_shelf_id uuid)` RPC: custom shelves only; moves its books to the end of `want`, then deletes it.
- `remove_book(p_simania_id int)` RPC: deletes the caller's shelf_books row and closes the position gap.
