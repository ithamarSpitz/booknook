---
id: S20-T3
stage: 3
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S20-T2
allowed_paths:
  - supabase/functions/recommendations/index.ts
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

The `recommendations` function works for a reader with a large library. Today it answers 500 because one works lookup puts thousands of Hardcover IDs into a single URL.

# Scope

Contract: "Large ID lists (S20)".

In `supabase/functions/recommendations/index.ts`, every `.in(...)` query goes through `selectInChunks` from `../_shared/chunked.ts`:
- `loadWorks` (`works` by `hardcover_id`; the failing one);
- the negative-seed `works` by `id`;
- the `editions` by `work_id` lookups (author hint around line 128, and the genre-shelf editions around line 496, keeping its `.gt("simania_id", 0)` inside each chunk);
- and any other `.in(` in this file.

Error handling stays as today: an error still goes through `fail(...)` or the existing branch. Nothing else changes.

# Tests (`tests/functions/recommendations-handler.test.ts`)

1. A reader whose seeds reference 2,500 distinct similar Hardcover IDs gets a 200 response. The fake database sees no `in` list longer than 100, and the stored recommendations equal those computed from the full set.
2. A works chunk error still gives the same error response as a single failed query today.
3. Existing tests pass. If the fake database helper in the test file records `in` filters, reuse it; otherwise extend it inside this test file.

# Acceptance criteria

1. The behavior above; `check:functions` and `test:functions` pass.
