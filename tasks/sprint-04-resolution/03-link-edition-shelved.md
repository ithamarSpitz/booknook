---
id: S4-T3
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/functions/link-edition/index.ts
  - tests/functions/link-edition-handler.test.ts
  - tests/functions/helpers/fake-db.ts
context:
  - contract
  - architecture.functions
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

A book the reader already owns is never kept as a recommendation: when `link-edition` links a recommended work to a Hebrew edition the caller has on a shelf, it removes that recommendation.

# Why

A shelved Hebrew edition can be unlinked (no `work_id`) when recommendations are generated, so its own original can be recommended back (live case: "הדירה בפריז" on the reader's "קראתי" shelf, "The Paris Apartment" recommended). When the browser later matches the recommendation to that same edition, `link-edition` claims the edition for the work and keeps the recommendation.

# Scope

In `supabase/functions/link-edition/index.ts`, after the edition is stored and linked to `work_id` (the existing claim and the existing 409 for another work stay unchanged), and before updating the recommendation:

1. Check, with the user-scoped client, whether the caller has this `simania_id` on any shelf (`shelf_books` where `user_id` = caller), or any other edition whose `work_id` equals `input.work_id` (query `editions` for `simania_id`s with that `work_id`, then `shelf_books` for the caller with those ids).
2. If so: delete the caller's non-dismissed `recommendations` row for `work_id` with the service client (`user_id`, `work_id`, `dismissed = false`), then answer `409` with `{"error":"Already on your shelves."}` (through the existing `HttpError`/`errorResponse`). The edition link itself stays.
3. Otherwise behave exactly as today (set the recommendation `simania_id`, return `LinkEditionResponse`).

Do not change the browser, types or other functions. If the fake DB lacks a query method you need (for example `in`), add it to `tests/functions/helpers/fake-db.ts` without changing existing behavior.

# Tests

In `tests/functions/link-edition-handler.test.ts`, keep all existing tests and add:

1. The caller has the edition (unlinked before the call) on a shelf: response 409 `Already on your shelves.`, the edition is now linked to the work, the caller's recommendation row is gone.
2. The caller has a different edition of the same work on a shelf: same 409 and deletion.
3. A dismissed row for that work is never deleted.
4. Another user's shelf with that edition does not affect the caller (normal 200 response).

# Acceptance criteria

1. The behavior above, with all tests passing.
