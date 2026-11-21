# Testing

## Layers

| Layer | Tool | Command | Network |
|---|---|---|---|
| Database | pgTAP via Supabase CLI | `npm run test:db` | local stack only |
| Edge Functions, types | Deno | `npm run check:functions` | none |
| Edge Functions, unit | Deno test with stubbed `fetch` and a fake DB client | `npm run test:functions` | none |
| Web, pure modules | `node --test` | `npm run test:web` | none |
| Integration gate | Node script against local stack and live APIs | `npm run verify:integration` | live |
| Resolution gate | Deno script: real resolver, in-memory DB, live Wikidata/NLI/Hardcover, real problem books | `npm run verify:resolution` | live |
| Localization gate | Deno script: the real recommendation localization chain (title hint, then author path) on real books, live Wikidata/NLI/Hardcover/Simania | `npm run verify:localization` | live |
| Repair gate | Deno script: real link repair proposals and catalog audit against a read-only production session | `npm run verify:repair` | live |

## Shared local Supabase stack

There is one local Supabase stack (`project_id = "booknook"`, API on 54321, DB on 54322), started once by the operator with `npm run supabase:start`. Harness worktrees all talk to it.

- Only tasks whose brief says so may run `supabase db reset` or `supabase test db`. The roadmap never puts two such tasks in the same stage.
- No task starts, stops or reconfigures the stack.
- Automated tests never call Simania, Hardcover, Wikidata or NLI; only the live gates above do. Stub `fetch` with recorded fixtures under `tests/functions/fixtures/`.
- `npm run verify:repair` is read-only against production: it validates known repair cases and runs the catalog audit without applying links.

## Fixtures

Use real recorded shapes. The prototype (`prototype/test-page.html` and the current `_shared` code) shows the response formats.

## Fallback no-regression routine

Before and after changing the fallback, run `npm run verify:fallback -- --population` and `npm run verify:fallback -- --replay-linked`, saving each JSONL result. Run each before/after pair one after the other, not in parallel: the probes share the production Hardcover key and its daily quota. The review passes `original_year` to `localizeFallback` the way the browser gets it, so the year guard is checked. Compare matching before/after runs with `npm run verify:fallback -- --compare <before> <after> [--keep <file>]`; `--compare` ignores non-JSON lines, `--keep` supplies additional work keys whose existing decisions must be preserved, and comparison exits 1 when a protected linked decision is lost (0 otherwise). Live probes retry Wikidata HTTP 429 responses up to three times with a 30-second wait. Review every change and unverified result; do not run `npm run refresh:all -- --apply` until the changes are reviewed.

Before opening the production database, `refresh:all` and the `verify:fallback` population and replay modes make one Hardcover `{ me { id } }` request and print the `x-ratelimit-daily-remaining` value as `hardcover_daily_remaining` (`null` when unavailable). `--min-hardcover <n>` sets the minimum remaining daily budget and defaults to `1500`; when a numeric remainder is below it, the command stops with exit code `4`. `--force-hardcover` permits the run despite a low numeric remainder. The compare mode makes no budget request.

## Operator routine

- Run `npm run audit:authors` for a read-only review of existing positive-edition links used by shelves or recommendations. It prints one JSON line for each link rejected by the browser's author guard, followed by checked and rejected totals; it does not modify the catalog. `npm run audit:authors -- --all` checks every linked edition, not only those used by shelves or recommendations.
- Only with the operator's explicit OK, unlink a reviewed false link regardless of its current resolution status with `npm run unlink:fallback -- --apply --simania <id> --any-status`. The override is deliberately restricted to one positive Simania ID; it resets that edition to pending and clears its recommendation references atomically.
- Run `npm run requeue:not-found` to list unresolved editions (`resolve_status = 'not_found'`, no work) that a shelf, recommendation or genre row still references; it is a read-only dry run that prints one JSON line per edition and a `total`. `--simania <id>` limits it to one edition and also selects an edition that no shelf, recommendation or genre row references. After review, run it with `--apply` to reset those editions to `pending` and clear `resolved_at`, then run `npm run refresh:all -- --apply` to resolve them again.
- Run `npm run report:omnibus` for a read-only list of editions linked with `resolve_status = 'omnibus'`: one JSON line per edition, ordered by `resolved_at`, then a `total`. Review every line after each refresh.
- Run `npm run series:links` to link unresolved series editions (`not_found`, no work, non-empty `series`) by series position. Steps:
  1. Dry run (no flags). It makes no database writes and prints one JSON line per target, either with a `proposal` (`hardcover_id`, `title`, `users_read_count`) or a skip `reason`, then `{ "proposals": n, "skipped": n }`. `--simania <id>` limits it to one edition. Before any Hardcover request it checks the remaining Hardcover budget; `--min-hardcover <n>` (default 1500) sets the minimum and `--force-hardcover` skips the check.
  2. Review every proposal: the anchors, the series and the proposed book must be the edition's book.
  3. Run `npm run series:links -- --apply`. It links each proposal and prints `{ "linked": n }`; it exits 1 if any link failed.
  4. List the links by status `series` and check them, as with `report:omnibus`.
- Run `npm run refresh:all -- --apply` only after review. Each failed book prints a JSON line shaped as `{ "failed": { "title", "step", "function", "status", "message" } }`; `step` is `recommendations`, `localize`, `genre-hint` or `details`, `status` is the HTTP status or null, and the redacted message is limited to 200 characters. Processing continues with the next book, and each reader's final summary includes the `failed` total; credential or reader-session failures stop with exit 2.
  - Step 4 (book details) covers each reader's referenced editions whose details were never fetched (`details_at` is null) and also editions still `pending`.
  - `--concurrency N` controls concurrent localization work; `N` must be an integer from 1 through 8 and defaults to 4. One throttle is shared across the entire run, including all readers and concurrent work, and keeps Simania request starts at least one second apart.
  - `--skip-cache <file>` skips English-only recommendation cards and genre rows whose work was checked without failure or a link less than seven days ago. A change to any `.js` file under `public/js` or `.ts` file under `supabase/functions`, including subdirectories, clears all cached entries; skipped genre rows also skip `genre-hint`. Keep this cache file outside the repository. Each reader's summary includes `skipped`, the total skipped cards and genre rows.
