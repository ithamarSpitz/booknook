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
2. `create or replace function public.replace_genre_recommendations(...)` with the same signature, security, grants and all existing rules (see `20261103000100_genre_recommendations.sql`). Each row now also requires the key `because`: an array of at most 10 distinct non-zero integers. Validate it the way `replace_recommendations` validates `because` (`20261025000200_replace_recommendations.sql`); a bad value gives `22023`. Insert it.
   - The allowed key set becomes the old keys plus `because`, so a row without `because` is rejected.
   - Re-apply the function's revoke/grant statements, as the original migration does.

Tests:
- Update `supabase/tests/06_genre_recommendations.sql` so its payloads include `because` (for example `[]` or `[1]`). Every existing assertion keeps its meaning; do not delete any.
- New `supabase/tests/09_genre_because.sql`:
  - `because` is stored as given.
  - A missing `because`, a fractional or null element, a duplicate, 0, or 11 elements is each rejected with `22023`.

Do not run `supabase db reset` or `supabase test db`; CI runs the database tests.

# Acceptance criteria

1. The behavior above. The verification check passes, and both pgTAP files are consistent with `supabase/tests/` conventions.
