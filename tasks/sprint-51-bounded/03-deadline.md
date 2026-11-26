---
id: S51-T3
stage: 3
model_class: worker
timeout_minutes: 90
review: true
depends_on:
  - S51-T2
allowed_paths:
  - scripts/rematch-cached.ts
  - supabase/functions/_shared/author-sound.ts
  - tests/functions/rematch-deadline.test.ts
  - tests/functions/author-sound.test.ts
  - tests/functions/rematch-concurrency.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "const t=require('fs').readFileSync('scripts/rematch-cached.ts','utf8');if(!t.includes('--work-timeout'))throw new Error('--work-timeout missing')"
---

# Goal

Implement **Work deadline (S51)** in `scripts/rematch-cached.ts` and **Sound lookup fail-fast (S51)** in `supabase/functions/_shared/author-sound.ts`. Spend few tokens.

1. **Deadline.** Run each work's body (English loop and `--hebrew` editions) under a deadline set by `--work-timeout <seconds>`: an integer 30 to 3600, default 600. Anything else is a usage error.
   - On timeout, the work's result is `provider_failure` with `failures: [{ provider: "deadline", error: "600 s; pending: wikimedia,simania" }]`, built from `pendingHosts()` in `scripts/lib/provider-throttle.ts`. Output stays in work order.
   - A timed-out work must not print later or change shared state when its promises settle. Discard its late results.
   - The S50 end-of-run recheck runs deadline failures once more under the same deadline.
2. **Fail-fast.** In `hebrewAuthorBySound`, the query loop calls `searchBooks` up to 26 times in a row. On the first thrown error, stop the loop and rethrow; don't continue with the next query. A search that succeeds with 0 results is not an error.

# Acceptance criteria

1. `tests/functions/rematch-deadline.test.ts`, with fake providers where one work's request never resolves, checks:
   - `--work-timeout 30` (fake clock) ends that work as `provider_failure` with `provider: "deadline"`;
   - the works after it are processed, and the output is in work order;
   - with `--concurrency 3`, the output is byte-identical to `--concurrency 1`;
   - the recheck runs it once more;
   - `--work-timeout 5` is rejected.
2. `tests/functions/author-sound.test.ts` adds a fake `searchBooks` that throws on the 2nd call: `hebrewAuthorBySound` rejects, and the fake was called exactly 2 times.
3. Existing tests pass.
4. All verification commands pass.
