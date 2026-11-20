---
id: S24-T3
stage: 3
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S24-T2
allowed_paths:
  - scripts/refresh-all.ts
  - tests/functions/refresh-all.test.ts
  - package.json
context:
  - contract
  - architecture.testing
environment: null
verification:
  - node_modules/.bin/deno check scripts/refresh-all.ts
  - npm run test:functions
---

# Goal

`npm run refresh:all -- --apply --skip-cache <file>` does not check again English-only books that were checked recently with no result, under the same code. Contract: the `npm run refresh:all` section, "**Speed (S24).**", the Skip cache rule.

# Scope

1. `scripts/refresh-all.ts`:
   - Parse `--skip-cache <file>`.
   - `codeHash()`: the SHA-256 hex digest described in the contract, over `public/js/**/*.js` and `supabase/functions/**/*.ts` relative to the repo root, sorted by path.
   - Read, write, hash and clock go through injected deps (`readCache`, `writeCache`, `codeHash`, `now`), so tests need no file access and no real time.
   - Load the cache once in `main`, share it across readers, apply the skip and add rules exactly as in the contract, and write it once at the end, also when the run stops with an error.
   - Add `skipped` to each reader summary.
   - Without `--skip-cache`, the behavior and output are the same as before except `skipped: 0`.
2. `package.json`: add `--allow-write` to the `refresh:all` script, nothing else.

# Tests

Add to `tests/functions/refresh-all.test.ts`, with in-memory cache deps and a fake clock.

1. **Skip:** a card and a genre row whose work is cached, with the same code hash and 1 day old, make no `genre-hint`, localize or Simania call; `skipped` is 2.
2. **Stale:** an 8-day-old entry and an entry under a different code hash are checked again.
3. **Add only no-result books:** after a run, the cache has the books that were checked with no failure and no link, with the fake clock time. It does not have the linked book or the failed book.
4. **Across readers:** reader A checks work W with no result; reader B, who also has W, skips it in the same run.
5. **Bad file:** invalid JSON exits `2` before any network call.
6. **Written on stop:** when a reader session fails (exit `2`), the cache is still written once with what was done.
7. **Hash:** `codeHash` changes when the contents of one file change and when a path changes, and is the same for the same files given in a different order.
8. **No flag:** a run without `--skip-cache` makes the same calls as before.
9. Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
