---
id: S20-T4
stage: 3
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S20-T2
allowed_paths:
  - supabase/functions/_shared/catalog.ts
  - supabase/functions/link-edition/index.ts
  - tests/functions/add-book-catalog.test.ts
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

The remaining Edge Function lookups by a list of IDs use the chunked helper too, so no other path can hit the over-long URL failure.

# Scope

Contract: "Large ID lists (S20)".

1. `supabase/functions/_shared/catalog.ts`: the `works` lookup `.in("id", workIds)` (around line 336) goes through `selectInChunks`. On error it still returns `null`, as today.
2. `supabase/functions/link-edition/index.ts`: the `.in("simania_id", siblingIds)` query (around line 128) goes through `selectInChunks`, keeping its `.eq("user_id", userId)` inside each chunk. Errors are handled as today.
3. Nothing else changes.

# Tests

1. In `add-book-catalog.test.ts`, a catalog lookup with 250 linked work IDs makes chunked requests of at most 100 and gives the same result as before.
2. In `link-edition-handler.test.ts`, the sibling update or select with 250 sibling IDs is chunked and gives the same result.
3. Existing tests pass.

# Acceptance criteria

1. The behavior above; `check:functions` and `test:functions` pass.
