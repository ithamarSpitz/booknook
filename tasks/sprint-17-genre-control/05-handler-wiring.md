---
id: S17-T5
stage: 4
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S17-T3
  - S17-T4
allowed_paths:
  - supabase/functions/recommendations/index.ts
  - tests/functions/recommendations-handler.test.ts
  - tests/functions/recommendations-logic.test.ts
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

The `recommendations` run reads the reader's shelf count and genre preferences, stores the planned shelves with their genre keys, and stores the reader's genres.

# Scope

Contract: "Genre recommendation shelves" steps 3a, 4, 6 and 7, and the two replacement RPCs.

In `supabase/functions/recommendations/index.ts` (`storeGenreRecommendations` and its helpers):
1. Load `profiles.genre_shelf_count` and the caller's `genre_preferences` with the service client.
2. Pass them to `buildGenreShelves`, and use `missingCandidateIds` with 200.
3. Send `genre_key` in every `replace_genre_recommendations` row.
4. After storing the shelves, compute `readerGenres` and call `replace_reader_genres`. A failure there is logged and ignored, and never fails the response or the shelves.
5. With no seeds, also clear `reader_genres` (empty array).

# Tests

1. In the handler tests, the stored payload carries `genre_key`, honors a hidden and a pinned preference, and respects `genre_shelf_count`.
2. `replace_reader_genres` gets the expected rows; when it fails, the response is still 200 and the shelves are stored.
3. Existing tests pass.

# Acceptance criteria

1. The behavior above; `check:functions` and `test:functions` pass.
