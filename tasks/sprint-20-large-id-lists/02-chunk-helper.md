---
id: S20-T2
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S20-T1
allowed_paths:
  - supabase/functions/_shared/chunked.ts
  - tests/functions/chunked.test.ts
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

A shared helper runs a PostgREST `in` lookup over any number of values without building an over-long request.

# Scope

Contract: "Large ID lists (S20)".

New `supabase/functions/_shared/chunked.ts`:
1. `selectInChunks<T>(values, run, { size = 100, concurrency = 4 } = {})`:
   - `values` is the list;
   - `run(chunk)` returns the `{ data, error }` result of one query for that chunk;
   - it de-duplicates `values` first, splits them into chunks of at most `size`, runs at most `concurrency` chunks at a time, and returns `{ data: T[], error: null }` with all rows concatenated;
   - on the first chunk error it returns `{ data: null, error }`;
   - an empty list makes no call and returns `{ data: [], error: null }`.
2. A typed, generic helper, with no Supabase import needed. Callers pass a closure such as ``(chunk) => db.from("works").select("*").in("hardcover_id", chunk)``.

No callers change in this task (S20-T3 and S20-T4 do that).

# Tests (new `tests/functions/chunked.test.ts`)

1. 2,500 values give 25 calls, each with at most 100 values, and all rows are returned.
2. Duplicates in `values` are sent once.
3. No more than 4 calls are in flight at a time.
4. An error in chunk 7 returns that error and `data: null`.
5. An empty list makes no call.

# Acceptance criteria

1. The behavior above; `check:functions` and `test:functions` pass.
