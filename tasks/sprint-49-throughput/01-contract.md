---
id: S49-T1
stage: 1
model_class: worker
timeout_minutes: 20
review: true
allow_protected: true
depends_on: []
allowed_paths:
  - docs/contract.md
context:
  - contract
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const k of ['**Sound lookup input (S49).**','**Failure accounting (S49).**','**Provider retry (S49).**','**Response cache (S49).**','**Work concurrency (S49).**','**Run health (S49).**'])if(!t.includes(k))throw new Error(k)"
---

# Goal

Add six general rules to `docs/contract.md`, right after the last S46/S47 rule, with these exact bold names. No book-specific constants. Spend few tokens.

Measured on 2026-11-25 (15 works, `scripts/rematch-cached.ts --offset 53 --limit 15`, local DB copy, per-request timing with `tasks/sprint-49-throughput/examples/fetchlog.ts`): 317 s wall clock, 21 s per work; 185 s inside requests. 3 of 15 works were `provider_failure`, all `query.wikidata.org` aborts at the 12 s timeout. SPARQL latency: median 0.2 s, p90 5.4 s, one success at 11.3 s. An earlier 53-work run on the same box had 17 failures (Wikidata 9, sound 5, NLI 1, Simania 1, one with an empty `failures` array).

1. **Sound lookup input (S49).** `hebrewAuthorBySound` never sends an empty or missing query. A name whose surname has no Latin letters (so no Hebrew spellings) returns `null` without any search. It never throws on its input.
2. **Failure accounting (S49).** Every `rematch:cached` line with `"skipped":"provider_failure"` has at least one entry in `failures`. A step that marks the work failed always records `{provider, error}` for that work, including steps after the candidate search (for example the `author_books` checks).
3. **Provider retry (S49).** In the operator scripts (`rematch:cached`, `measure:links`), an idempotent provider request (Wikidata API and SPARQL, NLI, Wiktionary, Simania search and book details) that times out or gets HTTP 5xx is retried once, with a timeout of 25 s, after a 1 s pause. HTTP 429 handling stays as it is. Hardcover is not retried by this rule. Edge functions keep today's behavior: the retry is off unless a script turns it on.
4. **Response cache (S49).** With `--cache-dir <dir>`, the operator scripts keep successful responses (HTTP 2xx, plus Wiktionary 404) of the idempotent providers in rule 3 on disk, keyed by method, URL and request body, for 7 days. A cached answer is used instead of a request. Hardcover, the database and quota checks are never cached. Without the flag, nothing changes.
5. **Work concurrency (S49).** `rematch:cached --concurrency <n>` (1 to 4, default 1) processes up to n works at once. Every provider host still gets at most one request in flight, with a minimum gap between request starts: Wikimedia 300 ms, Hardcover 1000 ms, Simania 250 ms, NLI 250 ms. Output lines are printed in work order and are byte-identical to `--concurrency 1` for the same provider answers. The Hardcover budget floor still stops the run.
6. **Run health (S49).** `npm run check:run-health -- <file>` reads a `rematch:cached` or `measure:links` output and exits non-zero when more than half of the checked works or editions are provider failures, when any recorded failure is HTTP 403 from Simania, or when the file has no summary line. The `rematch-measure.yml` jobs run it on each output, so an unusable run is red.

Change nothing else.
