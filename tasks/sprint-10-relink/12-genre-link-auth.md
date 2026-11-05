---
id: S10-T12
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/functions/match-by-author/index.ts
  - supabase/functions/link-edition/index.ts
  - tests/functions/match-by-author-handler.test.ts
  - tests/functions/link-edition-handler.test.ts
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

A genre shelf book can be linked to its Hebrew edition the same way a recommendation card is.

# Scope

Contract: `match-by-author` (authorization) and `link-edition` (authorization, and the genre row update).

1. `match-by-author`: the `404` check passes when the caller has a non-dismissed `recommendations` row **or** a `genre_recommendations` row for `work_id`. Read both with the caller's client, as the existing check does. Nothing else changes.
2. `link-edition`:
   - The same authorization.
   - On success, apply the existing rules to each of the caller's rows that exists. Either set its `simania_id` with the service client, or delete it under the "already on your shelves" rule; in that case still answer `409` `{"error":"Already on your shelves."}`.
   - A caller with only a genre row gets the same response body as today.


# Tests (fakes only)

1. `match-by-author`: a caller with only a genre row gets past `404`, and a caller with neither gets `404`.
2. `link-edition`:
   - A caller with only a genre row: the genre row's `simania_id` is set and the response is `200`.
   - With both rows: both are updated.
   - A genre-only caller whose shelves hold an edition of the work: the genre row is deleted and the response is `409`.
   - Neither row: `404`.
3. The existing tests keep passing.

# Acceptance criteria

1. The behavior above; all tests pass.
