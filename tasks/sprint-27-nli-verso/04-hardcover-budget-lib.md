---
id: S27-T4
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S27-T1
allowed_paths:
  - scripts/lib/hardcover-budget.ts
  - tests/functions/hardcover-budget.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run test:functions
---

# Goal

Add `scripts/lib/hardcover-budget.ts` for the contract paragraph "**Hardcover budget (S27).**".

# Scope

Export:

- `hardcoverDailyRemaining(fetchImpl = fetch, env = Deno.env): Promise<number | null>`:
  - Reads `HARDCOVER_API_KEY`. If it is not set, read the line `HARDCOVER_API_KEY=` from the file in `BOOKNOOK_ENV_FILE`, in the same way as `loadHardcoverApiKey` in `scripts/verify-fallback.ts` (quotes removed). Never print it.
  - POST `https://api.hardcover.app/v1/graphql` with body `{"query":"{ me { id } }"}`. Send the header `authorization: Bearer <key>`, unless the key already starts with `Bearer `.
  - Return the integer in the `x-ratelimit-daily-remaining` header, whatever the status.
  - Return `null` if there is no key, the request throws, or the header is missing or not an integer.
- `checkHardcoverBudget({ min, force, fetchImpl?, env?, log }): Promise<boolean>`:
  - Logs `{ "hardcover_daily_remaining": n }` as one JSON line.
  - Returns `false` only when `n` is a number, `n < min` and `!force`. In that case it also logs one line `Hardcover daily quota too low: n < min (use --force-hardcover)`.

# Tests

`tests/functions/hardcover-budget.test.ts`, with a fake `fetch`:

1. Header `4200` on a 200 gives `4200`.
2. Header `0` on a 429 gives `0`.
3. No header gives `null`; a fetch that throws gives `null`; no key gives `null` and makes no request.
4. The key in a `BOOKNOOK_ENV_FILE` temp file is used.
5. A key that already starts with `Bearer ` is not given a second prefix.
6. `checkHardcoverBudget`:
   - `min 1500` with `n=0` gives `false`;
   - with `force` it gives `true`;
   - `n=null` gives `true`;
   - `n=2000` gives `true`.
7. No log line contains the key.

# Acceptance criteria

1. The behavior above; `npm run test:functions` passes.
