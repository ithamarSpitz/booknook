---
id: S12-T7
stage: 4
model_class: worker
timeout_minutes: 20
review: true
allow_protected: false
depends_on:
  - S12-T6
allowed_paths:
  - scripts/refresh-all.ts
  - tests/functions/refresh-all.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

The refresh for all users also applies the catalog fallback to every English-only book.

# Scope

Contract: **`npm run refresh:all`** and "Catalog fallback for English-only books".

1. `scripts/refresh-all.ts`: steps 2 and 3 pass every `english_only` card to `localizeRecommendations`, not only those with a hint or Hebrew author. The `hebrew-candidates` calls go through `callAs` for that reader, like the other function calls.
2. The per-reader summary adds `fallbackLinked`, the count of links whose source was `nli_author`.

# Tests (`tests/functions/refresh-all.test.ts`)

1. A card with no hint and no Hebrew author is passed to localization.
2. `fallbackLinked` counts only `nli_author` links.

# Acceptance criteria

1. The behavior above; all tests pass.
