---
id: S33-T4
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S33-T1
allowed_paths:
  - scripts/recheck-links.ts
  - tests/functions/recheck-links.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

`npm run recheck:links` retries each edition that failed on a provider once, after the main pass. Contract: "**Recheck retries provider failures (S33).**".

# Scope

In `main` in `scripts/recheck-links.ts`:
- During the main pass, collect the editions whose `resolveMatch` result has `failed: true`, instead of printing them.
- After the main pass, recheck each collected edition once more, one at a time. Before each retry, wait at least 2 seconds through an injectable `sleep` in `RunDeps`, so tests don't wait. A retry result is handled exactly like a main-pass result: relink, unlink or keep.
- Only an edition that fails again prints `{"simania_id":…, "skipped":"provider_failure"}`.
- The dry-run summary becomes `{ checked, relinks, unlinks, retried }`.
- `--apply` behavior is otherwise unchanged.

# Tests

Add to `tests/functions/recheck-links.test.ts`, with stubbed deps (no network or database), following the existing tests:
1. An edition fails on the first call and succeeds with a relink on the second: one relink, no `provider_failure` line, and `retried: 1`.
2. An edition fails both times: one `provider_failure` line and `retried: 1`.
3. With no failures, `sleep` is never called and `retried: 0`.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
