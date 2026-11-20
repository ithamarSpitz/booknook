---
id: S27-T5
stage: 3
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S27-T4
allowed_paths:
  - scripts/refresh-all.ts
  - scripts/verify-fallback.ts
  - tests/functions/refresh-all.test.ts
  - tests/functions/verify-fallback-budget.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run test:functions
---

# Goal

`refresh:all` and `verify:fallback -- --population|--replay-linked` check the Hardcover budget first. Contract: "**Hardcover budget (S27).**".

# Scope

1. `scripts/refresh-all.ts` `main`:
   - Accept `--min-hardcover <n>` (a non-negative integer, default `1500`; a bad value exits `2` with the usage line) and `--force-hardcover`.
   - After argument parsing and before opening the database or calling anything else, run `checkHardcoverBudget`. Inject it through the existing deps.
   - On `false`, return `4`.
2. `scripts/verify-fallback.ts`:
   - The same flags and check, at the start of `--population` and `--replay-linked`, before `openProdDb`.
   - On `false`, exit `4`.
   - `--compare` never checks.
   - Keep the check injectable so tests make no network call.

# Tests

1. `tests/functions/refresh-all.test.ts`:
   - A budget check that returns `false` makes `main` return `4` without opening the database.
   - `--min-hardcover x` returns `2`.
   - The default min `1500` and `--force-hardcover` are passed to the check.
2. `tests/functions/verify-fallback-budget.test.ts`:
   - `--population` with a `false` check does not open the database;
   - `--compare` never calls the check.

Existing tests pass.

# Acceptance criteria

1. The behavior above; `npm run test:functions` passes.
