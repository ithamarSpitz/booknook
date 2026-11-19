---
id: S18-T4
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: true
depends_on:
  - S18-T1
allowed_paths:
  - supabase/functions/hebrew-candidates/index.ts
  - supabase/functions/_shared/types.ts
  - tests/functions/hebrew-candidates-handler.test.ts
context:
  - contract
  - architecture.functions
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - npm run check:contract
---

# Goal

`hebrew-candidates` tells the browser the year the original was published, so the browser can reject a "translation" that came out before it.

# Scope

Contract: "Catalog fallback for English-only books", the Request/Response line (`original_year`).

1. `supabase/functions/hebrew-candidates/index.ts`: the existing single Hardcover request that reads `description` also reads `release_year`. The response gets `original_year`: that value when it is a finite integer, otherwise null (also null when the Hardcover request fails). No extra request.
2. `supabase/functions/_shared/types.ts`: add `original_year: number | null` to `HebrewCandidatesResponse`. Nothing else in that file.

# Protected-path permission (operator decision, 2026-11-19)

`supabase/functions/_shared/types.ts` is protected. Permitted: the one field in Scope 2. Not permitted: any other change to that file, or any other protected file. The reviewer must fail the task otherwise.

# Tests (`tests/functions/hebrew-candidates-handler.test.ts`)

1. A Hardcover book with `release_year: 2023` gives `original_year: 2023`.
2. A missing or non-numeric `release_year` gives null; a failed Hardcover request gives null, and the response is still 200 as before.
3. Still exactly one Hardcover request.
4. Existing tests pass.

# Acceptance criteria

1. The behavior above; `check:functions`, `test:functions` and `check:contract` pass.
