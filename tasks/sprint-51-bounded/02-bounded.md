---
id: S51-T2
stage: 2
model_class: worker
timeout_minutes: 60
review: true
depends_on:
  - S51-T1
allowed_paths:
  - scripts/lib/provider-throttle.ts
  - tests/functions/provider-throttle.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Implement **Bounded provider waits (S51)** in `scripts/lib/provider-throttle.ts`. Spend few tokens.

In `hostLimitedFetch`, `run` calls `retryAfterWait(response, sleep)`, which sleeps `Retry-After` seconds with no cap, while the host's `state.chain` is held. Make every wait bounded:
- **429 handling:** cap `Retry-After` at 60 s. If the header asks for more than 60 s, return the 429 response at once. After `maxRetries`, return the last 429, as today.
- **Queue wait:** a request that waits more than 5 minutes for its turn in the host queue rejects with `new Error("host queue timeout")`. It must **not** run its fetch later, and the queue keeps moving for the requests behind it.
- **Pending report:** export a way to tell which host groups have requests in flight or queued, for example `pendingHosts(): string[]`. S51-T3 uses it.

Keep the spacing rules, the existing behavior for 429s up to 60 s, and all existing tests.

# Acceptance criteria

1. Tests with a fake clock and fake fetch check:
   - `Retry-After: 3600` returns the 429 without sleeping;
   - `Retry-After: 30` sleeps 30 s and retries;
   - a request queued behind one that never resolves rejects with `host queue timeout` after 5 minutes, and a third request then still runs;
   - `pendingHosts()` lists a group while its request is in flight and is empty after.
2. Existing throttle tests pass unchanged.
3. Both verification commands pass.
