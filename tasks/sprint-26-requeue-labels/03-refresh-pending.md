---
id: S26-T3
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S26-T1
allowed_paths:
  - scripts/refresh-all.ts
  - tests/functions/refresh-all.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run test:functions
---

# Goal

`refresh:all` step 4 also calls `book-details` for the reader's positive editions whose `resolve_status` is `pending`. Contract: the `npm run refresh:all` section, step 4 (S26).

# Scope

`scripts/refresh-all.ts`, `listBareEditionIds`:

- Select the reader's positive editions on recommendation, genre or shelf rows that have `details_at` null **or** `resolve_status = 'pending'`.
- Each edition appears once.
- Step 4 handling is unchanged: the shared Simania throttle, `fetchSimaniaPayload`, then `book-details { simania_id, simania }`.
- `editionsFilled` counts every successful call, as today.

# Tests

In `tests/functions/refresh-all.test.ts`:

1. The SQL text of `listBareEditionIds` includes the `pending` condition. Use the existing style of the SQL tests in this file if there is one; otherwise, test through a fake `sql` that records the query text.
2. A fake reader with one `pending` edition that already has details gets exactly one `book-details` call for it.
3. Existing tests pass.

# Acceptance criteria

1. The behavior above; `npm run test:functions` passes.
