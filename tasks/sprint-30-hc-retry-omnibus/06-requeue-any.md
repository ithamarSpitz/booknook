---
id: S30-T6
stage: 2
model_class: worker
timeout_minutes: 15
review: true
allow_protected: false
depends_on:
  - S30-T1
allowed_paths:
  - scripts/requeue-not-found.ts
  - tests/functions/requeue-not-found.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - npx deno check scripts/requeue-not-found.ts
---

# Goal

`npm run requeue:not-found -- --simania <id>` also selects a `not_found` edition that no shelf, recommendation or genre row references. Such editions exist: candidates that the author path saved, for example 145387 `התחדשות`, which S30 can now resolve. Without `--simania`, nothing changes. Contract: the `requeue:not-found` paragraph.

# Scope

- In `notFoundEditions`, when `simaniaId` is not null, drop the "referenced by a shelf, recommendation or genre row" condition. Keep `simania_id > 0`, `resolve_status = 'not_found'` and `work_id is null`.
- When `simaniaId` is null, the query is unchanged.
- The update in `requeueEditions` and everything else stay unchanged.

# Tests

In `tests/functions/requeue-not-found.test.ts`:
1. With `--simania 145387`, the select query text has no `shelf_books`, `recommendations` or `genre_recommendations` condition, and it binds 145387.
2. With no `--simania`, the query text still has all three conditions.

Existing tests pass. If an existing test asserts the old `--simania` query text, update only that expectation.

# Acceptance criteria

1. The behavior above; both verification commands pass.
