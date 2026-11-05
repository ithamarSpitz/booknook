---
id: S10-T7
stage: 1
model_class: worker
timeout_minutes: 20
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/migrations/20261106000100_positive_recommendation_editions.sql
  - supabase/tests/08_positive_recommendation_editions.sql
context:
  - contract
  - architecture.data_model
  - architecture.testing
environment: null
verification:
  - >-
    node -e "const t=require('fs').readFileSync('supabase/migrations/20261106000100_positive_recommendation_editions.sql','utf8').toLowerCase();const need=[[/update public\.recommendations[\s\S]*?simania_id\s*=\s*null/,'cleanup recommendations'],[/update public\.genre_recommendations[\s\S]*?simania_id\s*=\s*null/,'cleanup genre_recommendations'],[/alter table public\.recommendations[\s\S]*?check\s*\(\s*simania_id is null or simania_id > 0\s*\)/,'check recommendations'],[/alter table public\.genre_recommendations[\s\S]*?check\s*\(\s*simania_id is null or simania_id > 0\s*\)/,'check genre_recommendations']];for(const [r,n] of need){if(!r.test(t))throw new Error('missing '+n)}require('fs').accessSync('supabase/tests/08_positive_recommendation_editions.sql')"
---

# Goal

The database guarantees that a recommendation or genre recommendation never references an English edition.

# Scope

Contract: the `recommendations` and `genre_recommendations` tables, row `simania_id`.

New migration `supabase/migrations/20261106000100_positive_recommendation_editions.sql`:
1. `update public.recommendations set simania_id = null where simania_id < 0;` and the same for `public.genre_recommendations`. Production has 2 such rows in each.
2. Add a named check constraint `simania_id is null or simania_id > 0` to both tables.

New pgTAP test `supabase/tests/08_positive_recommendation_editions.sql`, in the style of the existing files in `supabase/tests/`:
- Inserting a recommendation and a genre recommendation with a negative `simania_id` fails with `23514`.
- Null and positive values still insert.
- A dismissed recommendation keeps working: `dismissed` can still be set on a row with a null `simania_id`.

Do not run `supabase db reset` or `supabase test db`; CI runs the database tests.

# Acceptance criteria

1. The behavior above. The verification check passes, and the pgTAP file is consistent with `supabase/tests/` conventions (plan count, `begin`/`rollback`).
