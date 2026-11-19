---
id: S19-T2
stage: 2
model_class: worker
timeout_minutes: 20
review: true
allow_protected: false
depends_on:
  - S19-T1
allowed_paths:
  - public/js/recs.js
  - tests/web/recs.test.mjs
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

The year guard never drops an edition whose Simania year is unknown (0), so the correct Don Quixote link (183461, year 0) stays.

# Scope

Contract: step 3a "Year guard (S18)", with the S19 sentence about year 0.

In `localizeFallback` in `public/js/recs.js` only: the guard skips a result only when its `year` is a finite number greater than 0 and below `original_year − 1`. Nothing else changes.

# Tests (`tests/web/recs.test.mjs`)

1. Rule F with `original_year: 1605` and a result with `year: 0` links it (the Don Quixote case).
2. `year: -1`, `year: null` and a missing `year` are never skipped.
3. The existing S18 guard tests still pass (2008 vs 2023 is skipped).

# Acceptance criteria

1. The behavior above; `test:web` passes.
