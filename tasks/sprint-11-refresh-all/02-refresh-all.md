---
id: S11-T2
stage: 2
model_class: hard_worker
timeout_minutes: 45
review: true
allow_protected: false
depends_on:
  - S11-T1
allowed_paths:
  - scripts/refresh-all.ts
  - tests/functions/refresh-all.test.ts
  - package.json
context:
  - contract
  - architecture.functions
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - npm run refresh:all
---

# Goal

After a deploy, one command brings every reader's recommendations and genre shelves fully up to date. That covers Hebrew editions, reasons, and filled covers and descriptions, so the app is already right when they open it.

# Scope

Contract: **`npm run refresh:all`**.

1. `package.json`: add `"refresh:all": "deno run --allow-net --allow-env --allow-read --allow-run --allow-sys scripts/refresh-all.ts"`. Change nothing else.
2. New `scripts/refresh-all.ts`:
   - Export `refreshReader(deps, reader)` and `main(args, deps)`. All I/O is injected: `projectKeys`, `listReaders`, `readerToken` and `callAs` (S11-T1), `fetchSimaniaPayload`, `localizeRecommendations` (`public/js/recs.js`) and read-only count queries. Reuse the browser modules; do not copy them.
   - Dry run (default):
     - Get the keys and list the readers.
     - Print the "before" counts per reader using `openProdDb({ readOnly: true })` (`scripts/lib/prod-db.ts`, with `loadOperatorEnv`): English-only non-dismissed recommendations, English-only genre rows, and bare positive editions (`details_at` null) on that reader's recommendation, genre or shelf rows.
     - Create no session and call no function. Exit `0`.
   - `--apply`: for each reader in turn, run the contract's steps 1-5 in order.
     - Step 2 uses the `recommendations` response cards that are `english_only` with a hint or Hebrew author.
     - Step 3 reads the reader's genre rows with the read-only session, calls `genre-hint`, then `localizeRecommendations` with `callFunction` bound to `callAs` for that reader.
     - Wait about 1 second between Simania-bound books.
     - Print the per-reader summary.
   - Exit `0` when every reader finished, even if some books failed (counted). Exit `2` when keys, the reader list or a session failed (the message names the step; no secret).
   - Never print a token or key. Never call `--apply` paths in dry run.

# Tests (new `tests/functions/refresh-all.test.ts`, fakes only)

1. Dry run calls `projectKeys`, `listReaders` and the count queries, and never calls `readerToken` or `callAs`.
2. Apply for 2 readers runs the steps in order, sequentially, and calls the functions with each reader's own token.
3. One book failing in step 3 is counted and the rest continue.
4. `readerToken` throwing gives exit `2` with a message that contains no token or key.
5. The summary counts match the fakes.

# Acceptance criteria

1. The behavior above; all tests pass.
2. `npm run refresh:all` (dry run) succeeds on this machine against production. It prints both readers' "before" counts and writes nothing.
