---
id: S51-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const k of ['**Bounded provider waits (S51).**','**Work deadline (S51).**','**Sound lookup fail-fast (S51).**'])if(!t.includes(k))throw new Error(k)"
---

# Goal

Add three general rules to `docs/contract.md`, right after the S50 rules, with these exact bold names. No book-specific constants. Spend few tokens.

Measured on 2026-11-26 (local DB copy, `rematch:cached --concurrency 4 --cache-dir`), two full English passes hung:
- **The S49 pass:** 4 works in its last 2 hours, at 450 of 1,767.
- **The S50 pass:** at 94 output lines, no new requests and no new cache entries for over 25 minutes, CPU idle. The work holding the ordered output finished in under 2 minutes when run alone.

The per-host limiter in `scripts/lib/provider-throttle.ts` waits for whatever `Retry-After` an HTTP 429 says, with no upper bound, while holding that host's queue. One long wait therefore blocks every request to that host, and every worker that needs it.

1. **Bounded provider waits (S51).** No provider wait in the operator scripts is unbounded:
   - a 429 `Retry-After` wait is capped at 60 s;
   - a 429 that asks for more than 60 s, or that remains after the retries, is returned to the caller as the 429 response, so the caller records a provider failure;
   - no queued request waits for its host slot for more than 5 minutes; past that it fails with `host queue timeout`.
2. **Work deadline (S51).** `rematch:cached --work-timeout <seconds>` (default 600) bounds each work in the English loop and each edition in `--hebrew`:
   - a work that runs longer ends as `provider_failure` with `failures: [{provider: "deadline", error: "<seconds> s; pending: <hosts>"}]`, where `<hosts>` lists the host groups with requests still in flight or queued;
   - the run continues, and the end-of-run recheck (S50) runs such works once more under the same deadline;
   - output order stays deterministic.
3. **Sound lookup fail-fast (S51).** In `hebrewAuthorBySound`, the first failed Simania search (timeout, 5xx, network error) stops the lookup and throws. It doesn't run the remaining queries of its plan.

Change nothing else.
