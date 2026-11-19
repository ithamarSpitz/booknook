---
id: S19-T3
stage: 2
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S19-T1
allowed_paths:
  - supabase/functions/_shared/hebrew-candidates.ts
  - supabase/functions/hebrew-candidates/index.ts
  - scripts/verify-fallback.ts
  - scripts/lib/fallback-compare.ts
  - tests/functions/hebrew-candidates.test.ts
  - tests/functions/hebrew-candidates-handler.test.ts
  - tests/functions/fallback-compare.test.ts
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

The operator review runs exactly the browser's decision, including the year guard, so a change to the guard can be checked before deploying.

# Scope

Contract: the Request/Response line (`originalYearOf`), "Population review" (the script passes `original_year`), the `--compare` bullet (non-JSON lines are ignored), and the new expected case for Don Quixote.

1. `supabase/functions/_shared/hebrew-candidates.ts`: export `originalYearOf(book)`. It returns `release_year` when that is a positive integer, otherwise null.
2. `supabase/functions/hebrew-candidates/index.ts`: use `originalYearOf` instead of its inline check. The behavior stays the same, except that 0 and negative years now give null.
3. `scripts/verify-fallback.ts`: in every mode (known cases, `--population`, `--replay-linked`), add `original_year: originalYearOf(<the Hardcover book it already loaded>)` to the `hebrew-candidates` response object passed to `localizeFallback`. No extra Hardcover request. Add the expected case `{ title: "Don Quixote", author: "Miguel de Cervantes Saavedra", expected: [183461] }` to `EXPECTED_CASES`.
4. `scripts/lib/fallback-compare.ts`: ignore lines that do not parse as a JSON object, instead of failing on "Invalid JSON".

# Tests

1. `originalYearOf`: 2023 gives 2023; 0, -5, 2023.5, "2023" and a missing value give null.
2. The handler test still sees `original_year` from `release_year` (existing tests), and `release_year: 0` gives null.
3. `fallback-compare`: a file whose first lines are `Initialize deno@2.9.6` messages compares the same as the clean file.
4. The script's population or replay decision passes `original_year` to `localizeFallback`. Test it with the script's injectable pieces, or with a small exported function that builds the response. Use whichever the file's structure allows without network.
5. Existing tests pass.

# Acceptance criteria

1. The behavior above; `check:functions` and `test:functions` pass.
