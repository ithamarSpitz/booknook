---
id: S8-T3
stage: 2
model_class: worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on:
  - S8-T1
  - S8-T2
allowed_paths:
  - supabase/functions/recommendations/index.ts
  - tests/functions/recommendations-handler.test.ts
  - tests/functions/helpers/fake-db.ts
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

Each recommendations run also computes and stores the caller's genre recommendation shelves.

# Scope

Contract: "Genre recommendation shelves" (all steps) and `replace_genre_recommendations`. In `supabase/functions/recommendations/index.ts`, after the ordinary cards are stored:

1. Build genre seeds: the ordinary seeds with weights, plus the caller's `reading`-shelf books with a `work_id` that are not already seeds, weight 2.5. Read their works' `tags` and `similar_ids`.
2. `missingCandidateIds(...)` from `_shared/genres.ts`; load those works from Hardcover (batches of 50, at most 100) and upsert them into `works` exactly as the ordinary path loads missing candidate works.
3. `buildGenreShelves(...)` with excluded works = the caller's shelved works and dismissed recommendations.
4. Edition per book (contract step 5): the caller's ordinary recommendation `simania_id` for that work, else the most recently resolved positive-ID edition linked to the work, else null. One query for the editions.
5. Call `replace_genre_recommendations` (service client) with `shelf_position`, `position`, `genre`, `work_id`, `simania_id`, `score`.
6. Wrap steps 1 to 5 so any error is logged and ignored (the ordinary response is unchanged). Put the genre step behind an injectable dependency so handler tests can stub or fail it.
7. Zero seeds: also clear genre rows (call the RPC with `[]`).

# Tests (`tests/functions/recommendations-handler.test.ts`, keep existing ones)

1. Seeds in two genres with enough candidates → the RPC receives two shelves in the right order with correct positions and editions (recommendation edition preferred, then catalog edition, then null).
2. A `reading`-shelf book counts as a genre seed with weight 2.5.
3. The genre step throwing → the ordinary response is still 200 and unchanged.
4. Zero seeds → RPC called with `[]`.

# Acceptance criteria

1. The behavior above; all tests pass.
