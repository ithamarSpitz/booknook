---
id: S12-T5
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S12-T1
allowed_paths:
  - scripts/unlink-fallback.ts
  - scripts/lib/prod-db.ts
  - tests/functions/unlink-fallback.test.ts
  - package.json
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - npm run unlink:fallback
---

# Goal

Every link the catalog fallback made can be listed and undone in one step.

# Scope

Contract: "Catalog fallback for English-only books" (`npm run unlink:fallback`).

1. `package.json`: add `"unlink:fallback": "deno run --allow-net --allow-env --allow-read --allow-sys scripts/unlink-fallback.ts"`. Change nothing else.
2. New `scripts/unlink-fallback.ts`, with I/O injected like `scripts/repair-links.ts`:
   - The dry run (default) uses `openProdDb({ readOnly: true })` with `loadOperatorEnv`. It prints one JSON line per `nli_author` edition (`simania_id`, Hebrew title, `hardcover_id`, English title), then a count. It writes nothing.
   - `--apply` (all) or `--apply --simania <id>` (one): in one transaction, set those editions' `work_id = null`, `resolve_status = 'pending'` and `resolved_at = null`, and set `simania_id = null` on `recommendations` and `genre_recommendations` rows that point to them. Print the counts.
   - Exit `2` on a bad argument.
3. `scripts/lib/prod-db.ts`: add a query helper only if it is needed; keep existing exports.

# Tests (new `tests/functions/unlink-fallback.test.ts`, fakes only)

1. A dry run lists only `nli_author` editions and makes no write call.
2. `--apply` updates the editions and both row tables in one transaction.
3. `--apply --simania 5` touches only edition 5. An edition whose status is not `nli_author` is never touched, even when named.
4. A bad argument gives exit `2`.

# Acceptance criteria

1. The behavior above; all tests pass.
2. With `BOOKNOOK_ENV_FILE` set, `npm run unlink:fallback` (dry run) succeeds against production on this machine and lists 0 editions before the release.
