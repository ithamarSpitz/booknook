---
id: S17-T3
stage: 2
model_class: worker
timeout_minutes: 40
review: true
allow_protected: true
depends_on:
  - S17-T1
allowed_paths:
  - supabase/migrations/20261119000100_genre_control.sql
  - supabase/tests/12_genre_control.sql
  - supabase/tests/06_genre_recommendations.sql
  - supabase/tests/09_genre_because.sql
  - supabase/tests/01_library.sql
  - supabase/tests/08_positive_recommendation_editions.sql
  - supabase/tests/11_dismissed_works.sql
  - supabase/functions/recommendations/index.ts
  - supabase/functions/_shared/types.ts
context:
  - contract
  - architecture.data_model
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('supabase/migrations/20261119000100_genre_control.sql','utf8');for(const w of ['genre_preferences','reader_genres','genre_shelf_count','genre_key','set_genre_preference','set_genre_shelf_count','replace_reader_genres','replace_genre_recommendations'])if(!t.includes(w))throw new Error('missing '+w);require('fs').accessSync('supabase/tests/12_genre_control.sql')"
---

# Goal

The database stores the reader's genre shelf choices (pinned, hidden, shelf count), the genres found for them, and up to 20 genre shelves keyed by genre key.

# Scope

Contract: the `profiles` table, `genre_recommendations`, `genre_preferences`, `reader_genres`, `set_genre_preference`, `set_genre_shelf_count`, "Service-only genre recommendation replacement" and "Service-only reader genre replacement".

1. New migration `supabase/migrations/20261119000100_genre_control.sql`:
   - `profiles.genre_shelf_count` with its default and check; no client update grant.
   - `genre_recommendations.genre_key`: added, filled from `genre` for existing rows, then `not null`; `shelf_position` check widened to 0-19.
   - Tables `genre_preferences` and `reader_genres` with RLS, policies and grants exactly as in the contract.
   - The RPCs `set_genre_preference`, `set_genre_shelf_count` and `replace_reader_genres`.
   - `create or replace` of `replace_genre_recommendations`, starting from its latest definition (`20261106000200_genre_because.sql`): require `genre_key`, at most 240 rows, `shelf_position` 0-19, at most 12 rows per `genre_key`, and store `genre_key`. Everything else unchanged.
2. `supabase/functions/_shared/types.ts`: `GenrePreferenceRow`, `ReaderGenreRow`, `ReaderGenreReplacement`; `genre_key` on `GenreRecommendationRow` and `GenreRecommendationReplacement`; `genre_shelf_count` on `ProfileRow`. Nothing else in that file.
3. pgTAP tests, new file `supabase/tests/12_genre_control.sql`. Update `06_genre_recommendations.sql`, `09_genre_because.sql` and `01_library.sql` only where the contract changed (the new payload field, the limits, the new profile column and its grants).

# Protected-path permission (operator decision, 2026-11-19)

`supabase/functions/_shared/types.ts` is protected. Permitted: adding the types and fields listed in Scope 2. Not permitted: any other change to that file, or any other protected file. The reviewer must fail the task otherwise.

# Operator decision on the 2026-11-19 review (no trigger)

The first attempts added a `BEFORE INSERT` trigger that defaults `genre_key` to `genre`. That is not allowed: no trigger, no default, and `genre_key` stays `not null` with no fallback. Resolve the conflict this way instead:
1. `supabase/tests/08_positive_recommendation_editions.sql` and `supabase/tests/11_dismissed_works.sql`: add `genre_key` (same value as `genre`) to every direct insert into `genre_recommendations`. Change nothing else in those files; the expected errors (for example `23514` in 08) must stay the same.
2. `supabase/functions/recommendations/index.ts`: the only permitted change is one added line in the `replace_genre_recommendations` row object, `genre_key: shelf.genre,` (today's Hebrew names are the keys). S17-T5 replaces it later. Nothing else in that file.
3. `types.ts`: `genre_key` is a required `string` on `GenreRecommendationReplacement` and `GenreRecommendationRow`, not optional.
4. Test 5 below ("the migration fills `genre_key`") must not read `supabase_migrations.schema_migrations`. Instead, check in the catalog that the column exists and is `not null`. Then check that a `replace_genre_recommendations` call stores the given `genre_key`.

# Tests (`12_genre_control.sql`)

1. `set_genre_preference`:
   - `pinned` assigns `pin_order` 0, 1, 2; re-pinning keeps the order; `auto` deletes the row; `hidden` clears `pin_order`.
   - A bad state, a blank key or a blank label raises `22023`; a 20th pin raises `22023`.
   - A reader cannot see another reader's rows.
2. `set_genre_shelf_count`: accepts 1 and 20; 0 and 21 raise `22023`. A direct client update of `genre_shelf_count` is denied.
3. `replace_reader_genres`: replaces all rows; a bad payload (extra key, negative count, position 100, duplicate position, 101 rows) raises `22023` and changes nothing; service role only.
4. `replace_genre_recommendations`: a missing `genre_key` raises `22023`; `shelf_position` 19 is accepted; 13 rows with one `genre_key` raise `22023`.
5. The migration fills `genre_key` for existing rows.
6. The existing pgTAP tests pass with only the updates allowed above.

The harness cannot run pgTAP here (no Docker). CI runs it after the push, so write the tests carefully against the existing files' style.

# Acceptance criteria

1. The behavior above; `check:functions` and `check:contract` pass.
