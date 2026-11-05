---
id: S10-T9
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: true
depends_on:
  - S10-T6
  - S10-T8
allowed_paths:
  - supabase/functions/_shared/genres.ts
  - supabase/functions/_shared/types.ts
  - supabase/functions/recommendations/index.ts
  - tests/functions/genres.test.ts
  - tests/functions/recommendations-handler.test.ts
context:
  - contract
  - architecture.functions
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

The recommendations run records, for each genre shelf book, which of the reader's books led to it.

# Scope

Contract: "Genre recommendation shelves" step 4 (last sentence), and `replace_genre_recommendations` (`because`).

1. `supabase/functions/_shared/genres.ts`:
   - `GenreSeed` gains `simaniaId: number`, the seed's shelved edition.
   - `genreCandidates` also returns, per candidate, each contributing seed's `simaniaId` with its contribution `weight * (1 - rank/40)`.
   - `buildGenreShelves` books gain `because: number[]`: contributors by contribution descending, ties by lower `simaniaId`, distinct, at most 10.
   - Scores, ordering and selection are unchanged.
2. `supabase/functions/recommendations/index.ts`: `genreSeeds` sets `simaniaId` from the seed or library item. Each `replace_genre_recommendations` row includes `because`.
3. `supabase/functions/_shared/types.ts`:
   - `GenreRecommendationReplacement` gains `because: number[]`.
   - `GenreBook` gains `because: number[]` and `because_titles: string[]`.

# Tests

1. `tests/functions/genres.test.ts`: two seeds that both list a candidate give `because` ordered by contribution. A third seed that does not list it is absent. Equal contributions order by lower `simaniaId`. A candidate with 12 contributors keeps 10. The existing tests keep passing, with scores unchanged.
2. `tests/functions/recommendations-handler.test.ts`: the `replace_genre_recommendations` payload rows carry `because`.

# Acceptance criteria

1. The behavior above; all tests pass.
