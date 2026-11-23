---
id: S45-T3
stage: 3
model_class: worker
timeout_minutes: 60
review: true
depends_on:
  - S45-T2
allowed_paths:
  - supabase/functions/_shared/catalog.ts
  - supabase/functions/_shared/hardcover.ts
  - tests/functions/resolve-trace.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

This is the first half of part 1 of **Hebrew direction (S45)**: the trace hook only. Wiring it into `--explain` is a separate task, S45-T3b. Spend few tokens.

Add an optional hook, `trace?: (event: ResolveTraceEvent) => void`, to the `resolveMatch` providers in `supabase/functions/_shared/catalog.ts`. Without the hook, nothing changes. Emit these events:
- `original`: `{ title, source }`;
- `english_author`: `{ name, source }`;
- **one `hardcover_query` event per actual provider search,** `{ query, results, best_title, best_score }`. To do this, pass the hook (or a callback) into `findHardcoverBook` in `supabase/functions/_shared/hardcover.ts`, so that each of its searches is reported, including the author retry.
  - `results` is the number of candidates that search returned, not "accepted or not".
  - `best_title` and `best_score` describe the best candidate even when it was rejected.
- `stop`: one of the contract values, emitted once when `resolveMatch` returns without a match.

Change no matching decision.

# Acceptance criteria

1. `tests/functions/resolve-trace.test.ts` drives the **real** `resolveMatch` with fake providers (fake Hardcover search, NLI and Wikidata). It must not replace `resolveMatch` or emit events by hand. Cover each `stop` value:
   - `no_original`;
   - `no_english_author`;
   - `no_hardcover_result`, where the search returns 0 candidates;
   - `title_below_threshold`, where the search returns candidates below the accept score; assert the real `results` count and `best_title`;
   - `author_mismatch`;
   - `guard_rejected`.
2. A test with an author retry asserts two `hardcover_query` events.
3. Existing tests pass unchanged.
4. Both verification commands pass.
