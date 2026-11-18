---
id: S15-T2
stage: 2
model_class: hard_worker
timeout_minutes: 45
review: true
allow_protected: false
depends_on:
  - S15-T1
allowed_paths:
  - supabase/functions/recommendations/logic.ts
  - supabase/functions/recommendations/index.ts
  - supabase/functions/_shared/genres.ts
  - tests/functions/recommendations-logic.test.ts
  - tests/functions/recommendations-handler.test.ts
  - tests/functions/genres.test.ts
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

A book the reader marked "לא הסגנון שלי" pushes similar books down on both the Recommendations page and the genre shelves, and no removed book of either kind comes back.

# Scope

Contract: "Recommendation scoring" (exclusion and **Negative seeds**) and "Books per genre" step 4.

1. `supabase/functions/recommendations/index.ts`: `loadDismissed` reads the caller's `dismissed_works` (`work_id`, `kind`) instead of `recommendations.dismissed`. Every dismissed work is excluded, as today. For `not_my_type` rows, load each work's `similar_ids` (from `works`) and pass them on as negative seeds to both the ordinary and the genre scoring.
2. `supabase/functions/recommendations/logic.ts`: export `NOT_MY_TYPE_WEIGHT = 5`. `scoreCandidates` takes the negative seeds and applies the contract rule:
   - subtract `5 * (1 - r/40)`, only from candidates a positive seed reached;
   - negative seeds never enter `because`;
   - drop scores `<= 0`.
3. `supabase/functions/_shared/genres.ts`: the same subtraction in the per-genre book scores, and drop scores `<= 0`. Genre qualification (evidence and count) is unchanged, and so is the genre `because` (positive contributions only).

# Tests

1. The contract example: a candidate at rank 4 of a 5-star seed, a 4-star seed and a not-my-type work scores `3.6` (within 1e-9).
2. A candidate only on a not-my-type list never appears. A candidate pushed to `<= 0` is dropped.
3. A `hide` work is excluded but subtracts nothing.
4. A genre shelf candidate is lowered and reordered by a not-my-type work; the genres that qualify are the same as without it.
5. Handler: `dismissed_works` rows of both kinds exclude their works from both outputs.
6. Existing tests still pass (update any that read `recommendations.dismissed` for exclusion).

# Acceptance criteria

1. The behavior above; all tests pass.
