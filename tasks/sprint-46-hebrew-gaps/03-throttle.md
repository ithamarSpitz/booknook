---
id: S46-T3
stage: 3
model_class: worker
timeout_minutes: 60
review: true
depends_on:
  - S46-T2
allowed_paths:
  - scripts/lib/provider-throttle.ts
  - scripts/rematch-cached.ts
  - scripts/measure-links.ts
  - supabase/functions/_shared/hardcover.ts
  - tests/functions/provider-throttle.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "const t=require('fs').readFileSync('scripts/rematch-cached.ts','utf8');if(!t.includes('provider-throttle'))throw new Error('rematch-cached.ts must use scripts/lib/provider-throttle.ts')"
---

# Goal

Implement **Provider throttle (S46)** for the scripts only. Spend few tokens.

1. Add `scripts/lib/provider-throttle.ts` with `throttledHardcoverFetch(fetchImpl, sleep, now)`:
   - one request at a time, at least 1000 ms apart;
   - on HTTP 429, wait `Retry-After` seconds, or 15 s if absent, and retry, at most 5 times;
   - after that, return the last response.
2. Move `throttledWikimediaFetch` from `scripts/measure-links.ts` into this file and re-export it from `measure-links.ts`, so nothing else breaks.
3. In `scripts/rematch-cached.ts`, send Hardcover and Wikimedia requests through these.
   - If `hardcover.ts` has no way to take a fetch, add an optional `fetchImpl` parameter or setter to it.
   - **Edge functions must keep today's behavior and speed:** without the new argument, `hardcover.ts` works exactly as now.

# Acceptance criteria

1. `tests/functions/provider-throttle.test.ts`, using a fake fetch and a fake clock, checks:
   - two calls are ≥ 1000 ms apart;
   - a 429 with `Retry-After: 2` waits 2000 ms and the retry succeeds;
   - six 429s in a row return the last 429 after 5 retries;
   - a non-Hardcover, non-Wikimedia URL is not delayed.
2. Existing tests pass unchanged.
3. All verification commands pass.
