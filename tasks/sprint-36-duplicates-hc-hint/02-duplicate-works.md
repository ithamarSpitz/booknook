---
id: S36-T2
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S36-T1
allowed_paths:
  - supabase/functions/link-edition/index.ts
  - tests/functions/link-edition-duplicates.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

`link-edition` accepts a Hebrew edition that is already linked to a duplicate work of the same book. Contract: "**Same-book duplicate works (S36).**".

# Scope

In `supabase/functions/link-edition/index.ts`:
- Add a small exported pure helper `sameBook(a, b)` for two work rows `{ original_title, original_authors }`. It is true when `normalize(title before the first colon)` is equal for both, and `similarity(a.original_authors[0], b.original_authors[0]) >= 0.85`. Use the existing `normalize` and `similarity` from `_shared/utils.ts`.
- At both places that throw 409 "Edition belongs to another work":
  - load the edition's work and the requested work (`original_title`, `original_authors`) with the service client;
  - if `sameBook` is true, continue without claiming or changing the edition. In the shelf-sibling query, use the editions of **both** works. Then update the recommendation and genre rows for `input.work_id` with this `simania_id`, exactly as today.
  - Otherwise throw the same 409 as today.
- Nothing else changes.

# Tests

New `tests/functions/link-edition-duplicates.test.ts`, following the stub style of `tests/functions/link-edition-handler.test.ts`:
1. Edition 32314 belongs to work B `The Strange Case of Dr. Jekyll and Mr. Hyde` / `Robert Louis Stevenson`. The request is for work A, with the same title and author. The response is 200, the recommendation row for A gets `simania_id` 32314, and the edition's `work_id` is still B.
2. Work B is `Peter Pan` / `J. M. Barrie`, and A is `Dr. Jekyll` …: 409.
3. Same book, but the caller has a shelved edition of work B: 409 "Already on your shelves", and A's recommendation rows are deleted.
4. Unit tests for `sameBook`: subtitle after a colon is ignored, and different authors give false.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
