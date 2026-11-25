---
id: S49-T4
stage: 4
model_class: worker
timeout_minutes: 60
review: true
depends_on:
  - S49-T3
allowed_paths:
  - scripts/lib/provider-cache.ts
  - scripts/rematch-cached.ts
  - scripts/measure-links.ts
  - tests/functions/provider-cache.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "for(const f of ['scripts/rematch-cached.ts','scripts/measure-links.ts']){const t=require('fs').readFileSync(f,'utf8');if(!t.includes('--cache-dir')||!t.includes('provider-cache'))throw new Error(f+' must support --cache-dir via scripts/lib/provider-cache.ts')}"
---

# Goal

Implement **Response cache (S49)**. Spend few tokens.

Dry runs store nothing: `rematch-cached.ts` uses a no-op `soundStore` and skips storing Wikidata author names unless `--apply` is set. So every dry run, and every `measure:links` run after it, repeats the same provider calls. In 15 works that was 112 Simania, 84 NLI, 91 Wikidata and 24 Wiktionary requests.

1. Add `scripts/lib/provider-cache.ts` with `cachedFetch(fetchImpl, { dir, ttlMs, now })` returning a `typeof fetch`. Install it the same way the scripts already install the throttles (wrapping `globalThis.fetch`), **outside** the throttles, so a cache hit makes no request and doesn't wait for the throttle.
   - **Cacheable hosts:** `www.wikidata.org`, `query.wikidata.org`, `nli.alma.exlibrisgroup.com`, `en.wiktionary.org`, and the Simania host the clients call. Everything else, Hardcover included, passes straight through.
   - **Key:** SHA-256 of method, URL and request body text. Store one JSON file per key with status, the headers needed to rebuild the response (content-type), the body text, and the time it was saved.
   - **What to store:** only HTTP 2xx, plus 404 for Wiktionary. Never errors, aborts or other statuses.
   - **Expiry:** an entry older than `ttlMs` (default 7 days) is ignored and refetched.
   - Writes are atomic (write to a temp file, then rename), so concurrent works never read half a file.
2. Add `--cache-dir <dir>` to `scripts/rematch-cached.ts` and `scripts/measure-links.ts`. Without it, nothing changes.
3. At the end of the run, print one stderr line: `{"cache":{"hits":N,"misses":N,"stored":N}}`. Never stdout, so the JSONL output stays the same.

# Acceptance criteria

1. `tests/functions/provider-cache.test.ts` (temp dir, stubbed fetch, fake clock) checks:
   - a second identical GET is served from disk with 0 calls;
   - different bodies are different keys;
   - an expired entry refetches;
   - a 500 or a thrown fetch is not stored;
   - a Wiktionary 404 is stored;
   - a Hardcover URL is never stored;
   - the rebuilt response has the same status, content-type and body.
2. A `rematch-cached` test with fakes shows the same JSONL output with and without `--cache-dir`.
3. All verification commands pass.
