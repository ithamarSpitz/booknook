---
id: S8-T1
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/migrations/20261103000100_genre_recommendations.sql
  - supabase/tests/06_genre_recommendations.sql
context:
  - contract
  - architecture.data_model
  - architecture.testing
environment: null
verification:
  - >-
    node -e "const t=require('fs').readFileSync('supabase/migrations/20261103000100_genre_recommendations.sql','utf8').toLowerCase();for(const w of ['create table public.genre_recommendations','enable row level security','replace_genre_recommendations','service_role','for update'])if(!t.includes(w))throw new Error('migration missing '+w);require('fs').accessSync('supabase/tests/06_genre_recommendations.sql')"
---

# Goal

Storage for the genre recommendation shelves: the `genre_recommendations` table and its service-only replacement RPC.

# Scope

Contract: `genre_recommendations` and "Service-only genre recommendation replacement". Follow the style and security patterns of the existing migrations for `recommendations` and `replace_recommendations` (look at them first).

1. New migration `supabase/migrations/20261103000100_genre_recommendations.sql`: the table with the exact columns, PK, references and defaults; RLS on, a `SELECT` policy for `user_id = auth.uid()`, no client write grants; the RPC with the contract's validation (`22023` / `23503`), profile lock first, delete-then-insert, shelf exclusion, one `clock_timestamp()`, execute only for `service_role`.
2. New pgTAP test `supabase/tests/06_genre_recommendations.sql`, in the style of `supabase/tests/02_replace_recommendations.sql`: a user reads only own rows; clients cannot insert/update/delete; the RPC replaces the whole set, drops works on the user's shelves, rejects a 6th genre, a 13th row in one genre, duplicate works and an edition of another work (`22023`), and is not executable by `authenticated`.

The pgTAP test runs in CI (`npm run test:db` needs Docker, so it is not in this task's verification). Write it carefully against the existing schema and tests.

# Acceptance criteria

1. The migration and test above; nothing else changed.
