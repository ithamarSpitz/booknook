---
id: S31-T7
stage: 4
model_class: worker
timeout_minutes: 40
review: true
allow_protected: true
depends_on:
  - S31-T4
allowed_paths:
  - scripts/recheck-links.ts
  - tests/functions/recheck-links.test.ts
  - package.json
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run test:functions
  - npx deno check scripts/recheck-links.ts
  - >-
    node -e "const p=require('./package.json');if(!/scripts\/recheck-links\.ts/.test(p.scripts['recheck:links']||''))throw new Error('recheck:links')"
---

# Goal

`npm run recheck:links` follows the contract paragraph "**`npm run recheck:links`**" exactly. It is an operator tool: dry run by default, `--apply` to write. It holds no book-specific constants.

# Scope

1. New `scripts/recheck-links.ts`, built like `scripts/series-links.ts` and `scripts/requeue-not-found.ts`:
   - an exported `main(args, overrides)` that returns an exit code;
   - injectable deps: `openProdDb`, `loadOperatorEnv`, `resolveMatch` (from `supabase/functions/_shared/catalog.ts`, with a service DB adapter as `repair:links` uses), `applyRepair` (from `scripts/repair-links.ts`, with the `status` parameter added in S30), `checkHardcoverBudget`, `log`, `error` and `now`.
   - Flags: `--apply`, `--all`, `--simania <id>`, `--min-hardcover <n>`, `--force-hardcover`. Anything else prints a usage line and returns `2`.
   - Run the budget check first; when it fails, return `4`.
   - Use a read-only connection unless `--apply`. Process editions sequentially.
   - Implement the scope, check, output and apply rules exactly as the contract says.
   - When `resolveMatch` reports `failed: true`, print `{ "simania_id": n, "skipped": "provider_failure" }` and never relink or unlink that edition.
2. `package.json`: add `"recheck:links": "deno run --allow-net --allow-env --allow-read --allow-write --allow-sys scripts/recheck-links.ts"` next to `series:links`. Change nothing else in the file.

Note: the agent cannot reach Hardcover, Wikidata or NLI. All tests use fakes.

Reviewer must check:
- the dry run opens a read-only connection and runs no write;
- `--apply` writes only where `work_id` still equals the old work ID;
- a provider failure never leads to a relink or an unlink.

# Tests

New `tests/functions/recheck-links.test.ts`, with fakes only:
1. **Relink.** Edition 16301 (status `wikidata`, work `hardcover_id` 1851773). `resolveMatch` returns book 488917 `The Rebel`, status `wikidata`. The dry run prints one `relink` line from 1851773 to 488917, then `{"checked":1,"relinks":1,"unlinks":0}`.
2. **No change.** `resolveMatch` returns the same `hardcover_id`: no line for it.
3. **Box-set unlink.** Edition `טרילוגיית X` and `resolveMatch` returns `null` (not failed): an `unlink` line.
4. **Provider failure.** `resolveMatch` returns `null` with `failed: true`: a `provider_failure` line, no relink or unlink.
5. **`--apply`.** A relink calls `applyRepair` with kind `relink` and the new status. An unlink runs an update with `work_id = null`, `resolve_status = 'not_found'` and the old-ID condition. Then `{"relinked":1,"unlinked":1,"skipped":0}`.
6. The budget check fails: exit `4` and no `resolveMatch` call. A bad flag: exit `2`.
7. Scope: without `--all` the query keeps only used works; with `--all` it does not. Statuses are only `wikidata`, `nli` and `fuzzy`.

# Acceptance criteria

1. The behavior above; all three verification commands pass.
