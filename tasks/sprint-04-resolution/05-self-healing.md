---
id: S4-T5
stage: 3
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S4-T4
allowed_paths:
  - supabase/functions/recommendations/index.ts
  - tests/functions/recommendations-handler.test.ts
  - tests/functions/helpers/fake-db.ts
  - supabase/migrations/20261102000100_retry_unresolved_editions.sql
context:
  - contract
  - architecture.functions
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "const t=require('fs').readFileSync('supabase/migrations/20261102000100_retry_unresolved_editions.sql','utf8').toLowerCase();if(!/update\s+public\.editions/.test(t)||!t.includes('pending')||!t.includes('not_found')||!/work_id\s+is\s+null/.test(t))throw new Error('migration must reset unlinked not_found editions to pending')"
---

# Goal

Unlinked shelved books heal themselves: every recommendations run retries resolving a couple of the caller's unlinked editions, and the editions wrongly stored as `not_found` before the resolver fixes are retried once.

# Why

Shelved editions without a `work_id` neither seed recommendations nor exclude their own original from them. Resolution today runs only in `add-book` and `book-details`, and `not_found` waits 14 days. The resolver fixes in this sprint (match title, NLI author search, English author hint) can link many of them, but only if resolution runs again.

# Scope

1. `supabase/functions/recommendations/index.ts`: at the start of the handler, after authentication and before loading the library, add a bounded self-healing step (see contract "Self-healing resolution"):
   - Read the caller's `shelf_books` (user-scoped client) with their full `editions` rows, keep editions with null `work_id` whose `resolve_status` is `pending`, or `not_found` with `resolved_at` at least 14 days old (same rule as `ensureResolved`), order by `added_at` desc, take at most 2.
   - Resolve them one after another with the existing `ensureResolved(serviceDb, edition)` from `_shared/catalog.ts`. Do not start another one after 20 seconds have passed since the step began. Catch every error; a failure never fails the request or changes the response shape.
   - Then continue as today (load library, seeds, ...), so a newly linked book seeds and is excluded in this same run.
   - Make the resolver injectable through the handler's existing dependency object so tests need no providers.
2. New migration `supabase/migrations/20261102000100_retry_unresolved_editions.sql`: one statement, `update public.editions set resolve_status = 'pending', resolved_at = null where work_id is null and resolve_status = 'not_found';` with a one-line comment explaining it retries editions stored as not_found before the November 2026 resolver fixes. No schema change.

Do not change exclusion, scoring, localization or other functions.

# Tests

In `tests/functions/recommendations-handler.test.ts`, keep existing tests and add:

1. A shelved `pending` edition is passed to the injected resolver; when the resolver links it to a work that is also a candidate, that work is excluded from the result and the book seeds (live case shape: "הדירה בפריז" shelved, "The Paris Apartment" candidate).
2. At most 2 editions are resolved per run, most recently added first; recent `not_found` (under 14 days) and linked editions are not resolved.
3. A resolver that throws does not fail the request.
4. No shelved unlinked editions: the resolver is not called.

# Acceptance criteria

1. The behavior above, with all tests passing; the migration check passes.
