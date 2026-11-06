---
id: S10-T8
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/migrations/20261106000200_genre_because.sql
  - supabase/tests/09_genre_because.sql
  - supabase/tests/06_genre_recommendations.sql
context:
  - contract
  - architecture.data_model
  - architecture.testing
environment: null
verification:
  - >-
    node -e "const t=require('fs').readFileSync('supabase/migrations/20261106000200_genre_because.sql','utf8').toLowerCase();if(!/alter table public\.genre_recommendations[\s\S]*add column because integer\[\] not null default '\{\}'/.test(t))throw new Error('missing because column');if(!/create or replace function public\.replace_genre_recommendations/.test(t))throw new Error('missing rpc');require('fs').accessSync('supabase/tests/09_genre_because.sql')"
---

# Goal

Genre recommendation rows store which of the reader's books they come from, so the book card can say why a book is recommended.

# Scope

Contract: the `genre_recommendations` table (`because`) and `replace_genre_recommendations`.

New migration `supabase/migrations/20261106000200_genre_because.sql`:
1. Add `because integer[] not null default '{}'` to `public.genre_recommendations`.
2. `create or replace function public.replace_genre_recommendations(...)` with the same signature, security, grants and all existing rules (see `20261103000100_genre_recommendations.sql`). Each row may now also carry the key `because`: an array of at most 10 distinct non-zero integers. Validate it the way `replace_recommendations` validates `because` (`20261025000200_replace_recommendations.sql`); a bad value gives `22023`. Insert it.
   - `because` is **optional**: a row without it stores `'{}'`. This keeps the current `recommendations` function, which does not send it until S10-T9, working when the migration lands first. The allowed key set becomes the old keys plus `because`; any other key is still rejected.
   - Re-apply the function's revoke/grant statements, as the original migration does.

Tests:
- `supabase/tests/06_genre_recommendations.sql` must keep passing unchanged, which proves payloads without `because` still work. Edit it only if a plan count must change, and delete no assertion.
- New `supabase/tests/09_genre_because.sql`:
  - `because` is stored as given.
  - A row without `because` stores `{}`.
  - A fractional or null element, a duplicate, 0, 11 elements, or a non-array `because` is each rejected with `22023`.

Do not run `supabase db reset` or `supabase test db`; CI runs the database tests.

# Acceptance criteria

1. The behavior above. The verification check passes, and both pgTAP files are consistent with `supabase/tests/` conventions.
