---
id: S49-T3
stage: 3
model_class: worker
timeout_minutes: 60
review: true
depends_on:
  - S49-T2
allowed_paths:
  - supabase/functions/_shared/utils.ts
  - supabase/functions/_shared/bridges.ts
  - supabase/functions/_shared/simania.ts
  - public/js/simania.js
  - scripts/rematch-cached.ts
  - scripts/measure-links.ts
  - tests/functions/provider-retry.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - npm run test:web
  - >-
    node -e "for(const f of ['scripts/rematch-cached.ts','scripts/measure-links.ts']){if(!require('fs').readFileSync(f,'utf8').includes('setProviderRetry'))throw new Error(f+' must turn the retry on')}"
---

# Goal

Implement **Provider retry (S49)**. Spend few tokens.

Today a 12 s abort (`fetchTimeout` in `supabase/functions/_shared/utils.ts`) is thrown at once: `providerFetch` in `bridges.ts` retries only HTTP 429/5xx once, and never an abort. Measured on 2026-11-25: all 3 failures in 15 works were `query.wikidata.org` aborts, while one SPARQL request succeeded at 11.3 s, so most of these are slow, not dead.

1. Add a module-level policy in `utils.ts`, for example `setProviderRetry({ timeoutMs: 25000, pauseMs: 1000 } | null)`. Default `null`: behavior exactly as today, so edge functions don't change.
2. When the policy is set, an idempotent provider request that aborts on its timeout or gets HTTP 5xx is retried **once**, after the pause, with the policy's timeout. Apply it where these requests are made:
   - `providerFetch` in `bridges.ts` (Wikidata API, SPARQL, NLI, Wiktionary);
   - Simania search and book details in `supabase/functions/_shared/simania.ts`;
   - `callTool` in `public/js/simania.js`, which the rematch uses for `matchHebrewBook`. It must keep working in the browser with no policy set: read the policy from an exported setter in that file, not from Deno APIs.

   Hardcover is not retried. HTTP 429 keeps its current handling.
3. `scripts/rematch-cached.ts` and `scripts/measure-links.ts` call the setters at start, before any request.

# Acceptance criteria

1. `tests/functions/provider-retry.test.ts`, with a stubbed `fetch` and short fake timeouts, checks:
   - no policy: an abort throws on the first attempt (today's behavior);
   - with the policy: an abort, then success, returns the success, and the second call uses the longer timeout;
   - two aborts in a row throw;
   - HTTP 502 then 200 succeeds;
   - a Hardcover URL is not retried;
   - the Simania client in `public/js/simania.js` follows the same rules.
2. Existing tests pass unchanged.
3. All verification commands pass.
