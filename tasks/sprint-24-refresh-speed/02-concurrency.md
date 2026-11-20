---
id: S24-T2
stage: 2
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S24-T1
allowed_paths:
  - scripts/refresh-all.ts
  - tests/functions/refresh-all.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run test:functions
---

# Goal

`npm run refresh:all` handles up to N books of a reader at once, with one Simania throttle for the whole run. Contract: the `npm run refresh:all` section, "**Speed (S24).**", the Concurrency and Simania rules only. The skip cache is a later task; do not add it.

# Scope

`scripts/refresh-all.ts` only.

1. Parse `--concurrency N` (default 4, integer 1 to 8). A bad value exits `2` before any network call, with a message naming the flag.
2. Create the Simania throttle once in `main` and pass it to `refreshReader` through the deps, so it is shared by all readers. Keep it injectable with the existing `sleep` dep: no real timers in tests. Every Simania fetch (localize and step 4) waits on it: at least 1,000 ms between the starts of any two requests, also while several books run at once.
3. Step 2: run the English-only cards with a pool of N workers. Each card still goes through its own `localizeRecommendations([item], ...)` call with the same `guardedCall`, `guardedFetch` and failure counting as today.
4. Step 3: run the genre rows with a pool of N workers, each doing `genre-hint` and then `localize` on that row, as today.
5. Step 4 stays one at a time.
6. Readers stay sequential. Counters (`failed`, linked sets) must stay correct when books run at once.

# Tests

Add to `tests/functions/refresh-all.test.ts`. Use the existing fakes; make fake function calls take a short random or staggered fake delay so books overlap.

1. **Same result:** one fake reader with 6 English-only cards and 6 genre rows, some linking, some not, one failing. Run with concurrency 1 and with 4. Equal summaries, and equal sets of `link-edition` request bodies.
2. **Pool size:** with concurrency 3 and 8 slow books, at most 3 are in flight at once, and at some point 3 are.
3. **Shared throttle:** two readers, concurrency 4, every book fetching Simania. Record a fake clock that advances only through the injected `sleep`. Every two Simania starts are at least 1,000 ms apart, across both readers.
4. **Bad flag:** `--concurrency 0`, `9`, and `x` each exit `2` and make no network call.
5. Existing tests pass. Where a test assumes the old per-reader throttle, change only the throttle assumption.

# Acceptance criteria

1. The behavior above; `npm run test:functions` passes (it type-checks `scripts/refresh-all.ts` through the test import).
