---
id: S49-T5
stage: 5
model_class: worker
timeout_minutes: 90
review: true
depends_on:
  - S49-T4
allowed_paths:
  - scripts/rematch-cached.ts
  - scripts/lib/provider-throttle.ts
  - tests/functions/rematch-concurrency.test.ts
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
    node -e "const t=require('fs').readFileSync('scripts/rematch-cached.ts','utf8');if(!t.includes('--concurrency'))throw new Error('--concurrency missing')"
---

# Goal

Implement **Work concurrency (S49)** in the English loop of `scripts/rematch-cached.ts`. Spend few tokens.

Measured on 2026-11-25: 15 works took 317 s (21 s each), so all 1,767 unlinked works would take about 10 h. The box was idle: the time is network waits.

Each provider host already answers in well under a second on average:

| Host | Average |
|---|---|
| Simania | 0.43 s |
| NLI | 0.69 s |
| Hardcover | 0.36 s |
| Wikidata API | 0.1 s |

So a few works in flight, with each host still getting one request at a time, cuts wall-clock time without raising any host's peak load beyond one request in flight.

1. **Per-host limiter.** In `scripts/lib/provider-throttle.ts`, generalize `serialized` into one limiter that gives each host group one request in flight and a minimum gap between starts:

   | Host group | Minimum gap |
   |---|---|
   | Wikimedia | 300 ms |
   | Hardcover | 1000 ms |
   | Simania | 250 ms |
   | NLI | 250 ms |

   Keep the existing 429 retries. `throttledHardcoverFetch` and `throttledWikimediaFetch` keep their behavior and their tests.
2. **`--concurrency <n>`** (an integer 1 to 4, default 1; anything else is a usage error). It is allowed only in the English loop, not with `--hebrew`, `--from` or `--hardcover-id`.
   - Run the per-work body for up to n works at once with a small promise pool.
   - **Keep output deterministic:** buffer each work's output lines and print them strictly in work order.
   - **Shared memos must stay correct under concurrency:** the per-name author memo, the originals cache and `currentFailures`. `currentFailures` becomes per-work state passed down, not a shared variable.
   - The Hardcover budget floor check still stops new works. Works already started may finish. The exit code stays 4.
3. **Progress.** Every 25 works, print `{"progress":{"done":N,"total":N,"elapsed_s":N}}` to **stderr** only.

# Acceptance criteria

1. `tests/functions/rematch-concurrency.test.ts` with fake providers that answer after random delays (seeded, deterministic) checks:
   - the stdout of `--concurrency 3` is byte-identical to `--concurrency 1` across 12 works, including a `provider_failure` work with its `failures` detail;
   - at no moment are two requests to the same host group in flight;
   - the budget floor stops the run with exit 4;
   - `--concurrency 5` and `--concurrency 2 --hebrew` are rejected.
2. Existing throttle and rematch tests pass unchanged.
3. All verification commands pass.
