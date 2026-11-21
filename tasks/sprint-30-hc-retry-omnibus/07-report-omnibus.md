---
id: S30-T7
stage: 2
model_class: worker
timeout_minutes: 20
review: true
allow_protected: true
depends_on:
  - S30-T1
allowed_paths:
  - scripts/report-omnibus.ts
  - tests/functions/report-omnibus.test.ts
  - package.json
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run test:functions
  - npx deno check scripts/report-omnibus.ts
  - >-
    node -e "const p=require('./package.json');if(!/scripts\/report-omnibus\.ts/.test(p.scripts['report:omnibus']||''))throw new Error('report:omnibus')"
---

# Goal

`npm run report:omnibus` lists every omnibus link so that the operator can check each one. Contract: "**`npm run report:omnibus`**".

# Scope

1. New `scripts/report-omnibus.ts`, built like `scripts/requeue-not-found.ts`:
   - an exported `main(args, overrides)` that returns an exit code;
   - `loadOperatorEnv`, then `openProdDb({ readOnly: true })`, and `sql.end()` in `finally`.
   - Query: editions with `resolve_status = 'omnibus'`, left-joined to `works` on `work_id`, ordered by `resolved_at`, then `simania_id`.
   - Print one JSON line per row with these keys, in order: `simania_id`, `title`, `author`, `series`, `work_id`, `hardcover_id`, `original_title`, `original_authors`, `resolved_at`. Then print `{ "total": n }`.
   - Any argument prints `Usage: report:omnibus` to stderr and returns `2`. No writes.
2. `package.json`: add `"report:omnibus": "deno run --allow-net --allow-env --allow-read --allow-sys scripts/report-omnibus.ts"` next to `requeue:not-found`. Change nothing else in the file.

# Tests

New `tests/functions/report-omnibus.test.ts`, using a fake `sql` like `tests/functions/requeue-not-found.test.ts`:
1. Two rows give two JSON lines with the exact key order, then `{"total":2}`. The connection was opened read-only and ended once.
2. Zero rows give `{"total":0}`.
3. An argument gives exit `2`, the usage text, and no database connection.
4. The query text contains `resolve_status = 'omnibus'` and no `update`, `insert` or `delete`.

# Acceptance criteria

1. The behavior above; all three verification commands pass.
