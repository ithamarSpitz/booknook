---
id: S30-T12
stage: 4
model_class: worker
timeout_minutes: 40
review: true
allow_protected: true
depends_on:
  - S30-T7
  - S30-T11
allowed_paths:
  - scripts/series-links.ts
  - scripts/repair-links.ts
  - tests/functions/series-links.test.ts
  - package.json
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run test:functions
  - npx deno check scripts/series-links.ts
  - npx deno check scripts/repair-links.ts
  - >-
    node -e "const p=require('./package.json');if(!/scripts\/series-links\.ts/.test(p.scripts['series:links']||''))throw new Error('series:links')"
---

# Goal

`npm run series:links` follows the contract paragraph "**`npm run series:links`**" exactly. It is an operator tool: dry run by default, `--apply` to write. It holds no book-, series- or author-specific constants.

# Scope

1. New `scripts/series-links.ts`, built like `scripts/requeue-not-found.ts`:
   - an exported `main(args, overrides)` that returns an exit code;
   - injectable deps: `openProdDb`, `loadOperatorEnv`, `bookDetails` (from `supabase/functions/_shared/simania.ts`), a Hardcover GraphQL function, `checkHardcoverBudget` (from `scripts/lib/hardcover-budget.ts`), `log`, `error` and `now`.
   - Flags: `--apply`, `--simania <id>`, `--min-hardcover <n>`, `--force-hardcover`. Anything else prints a usage line and returns `2`.
   - Run the budget check before any Hardcover request; when it fails, return `4`.
   - Use a read-only connection unless `--apply`.
   - Make requests one at a time.
   - Use the two `book_series` queries exactly as written in the contract.
   - Implement the targets, anchors, series, book, output and apply rules exactly as the contract says. Keep the pure decision steps as exported functions (`acceptSeries(anchors)` and `pickBook(books, anchorAuthors)`) so they can be tested without I/O.
2. `scripts/repair-links.ts`: give `applyRepair` an optional last parameter `status` (default `'original_title'`), used in its edition update. This lets `series:links` reuse the same work upsert with `'series'`. Change nothing else in the file.
3. `package.json`: add `"series:links": "deno run --allow-net --allow-env --allow-read --allow-sys scripts/series-links.ts"` next to `report:omnibus`. Change nothing else in the file.

Note: the agent cannot reach Hardcover or Simania. All tests use fakes. The query shapes in the contract were verified live on 2026-11-21.

Reviewer must check:
- both `book_series` query strings match the contract text;
- `--apply` updates only rows with `work_id` null;
- the dry run opens a read-only connection and writes nothing.

# Tests

New `tests/functions/series-links.test.ts`, with fakes only. The fixtures come from the live data:
- the anchor is Simania 77911 (`#4`), linked to work `hardcover_id` 213141 by `Enid Blyton`, with `book_series` `{ position: 4, series_id: 10178 }`;
- the targets are 60808 (`#3`), 77909 (`#6`) and 60810 (`#14`, author spelled `איניד (אניד) בְּלַייְטוֹן (בליטון)`).

1. `pickBook`:
   - Position 3, books 67535 `Well Done, Secret Seven` (36 readers) and 82054 (same title, 1 reader): picks 67535.
   - Position 14, 170692 `Look Out, Secret Seven` (26) and 2999497 `The Secret Seven` (1): picks 170692.
   - Two different titles with 20 and 10 readers: `ambiguous_book`.
   - A single book with 3 readers: `no_book`.
   - A compilation is dropped.
   - A book by `Other Author` is dropped.
2. `acceptSeries`:
   - One agreeing anchor gives 10178.
   - An extra anchor whose number is 5 but whose position in 10178 is 7 gives `anchor_disagrees`.
   - No rows gives `no_anchor`.
   - Two series that both agree give `ambiguous_series`.
3. `main`, dry run, with the three targets: three proposal lines (67535 for #3, 288209 for #6, 170692 for #14), then `{"proposals":3,"skipped":0}`. The connection was read-only and no update query ran.
4. `--apply`: each proposal runs the work upsert and an edition update with `'series'` and `work_id is null`, then `{"linked":3}`.
5. A target whose `seriesNumber` is `"ב"` gives `no_number`.
6. The budget check fails: exit `4` and no Hardcover request.
7. A bad flag: exit `2`.
8. `applyRepair` without `status` still writes `'original_title'`. Keep the existing repair-links tests passing.

# Acceptance criteria

1. The behavior above; all four verification commands pass.
