---
id: S26-T4
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S26-T1
allowed_paths:
  - scripts/requeue-not-found.ts
  - tests/functions/requeue-not-found.test.ts
  - package.json
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run test:functions
---

# Goal

Add `npm run requeue:not-found`, as described in the contract paragraph "**`npm run requeue:not-found`**".

# Scope

1. `scripts/requeue-not-found.ts`:
   - Follow `scripts/unlink-fallback.ts`: `loadOperatorEnv` and `openProdDb({ readOnly: !apply })`, injectable deps, `main(args, deps)` returning an exit code, and `sql.end()` in `finally`.
   - Usage: `requeue:not-found [--apply] [--simania <id>]`. A bad argument exits `2` with a usage line and opens no database.
   - Select positive-ID editions with `resolve_status = 'not_found'` and `work_id is null` that appear in `shelf_books`, in `recommendations.simania_id` or in `genre_recommendations.simania_id`. Order them by `simania_id`.
   - Print one JSON line per edition, then the total.
   - With `--apply`, run one `update` that sets `resolve_status = 'pending'` and `resolved_at = null` for exactly those IDs, re-checking `resolve_status = 'not_found' and work_id is null` in the `where` clause. Print `{ "requeued": n }`, where `n` is the number of updated rows.
   - Never print secrets.
2. `package.json`: add the script `"requeue:not-found": "deno run --allow-net --allow-env --allow-read --allow-sys scripts/requeue-not-found.ts"`, next to `unlink:fallback`.

# Tests

`tests/functions/requeue-not-found.test.ts`, with a fake `sql` that records queries and returns rows:

1. A dry run opens read-only, makes no update and prints the rows and `{ "total": 2 }`.
2. `--apply` opens writable and runs one update with both IDs and the re-check condition.
3. `--simania 32249` limits the select to that ID.
4. `--simania x`, `--foo` and `--simania` with no value exit `2` and open no database.
5. `sql.end()` is called on success and when a query throws.

# Acceptance criteria

1. The behavior above; `npm run test:functions` passes.
