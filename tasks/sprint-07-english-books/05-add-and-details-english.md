---
id: S7-T5
stage: 2
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S7-T3
allowed_paths:
  - supabase/functions/add-book/index.ts
  - supabase/functions/book-details/index.ts
  - tests/functions/add-book-handler.test.ts
  - tests/functions/book-details-handler.test.ts
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

`add-book` can shelve an English edition by `hardcover_id`, and `book-details` serves English editions (negative IDs) without Simania.

# Scope

Contract: `add-book` (English edition paragraph) and `book-details`.

1. `supabase/functions/add-book/index.ts`: accept exactly one of `simania_id` or `hardcover_id` (positive safe integers; `400` otherwise, including both or neither). For `hardcover_id`: check the shelf as today, `ensureEnglishEdition(catalogDb, hardcover_id)` (from `_shared/english.ts`, injectable in the deps object), skip `ensureEdition` and `ensureResolved`, then insert into `shelf_books` with `simania_id = -hardcover_id` and the same duplicate (`409`) handling and response as today. The Simania path is unchanged.
2. `supabase/functions/book-details/index.ts`: accept a negative `simania_id` (still a safe non-zero integer). For a negative ID: `ensureEnglishEdition(db, -simania_id)` (refreshes after 30 days), never Simania or the resolver; then the same shelf fields and response. Unknown English ID → `404`. Positive IDs unchanged.
3. `english_edition` on book cards is set by S7-T6 in `_shared/catalog.ts`; do not set it here. If the fake DB lacks something, work around it in your test file (S7-T6 owns `tests/functions/helpers/fake-db.ts` in this stage).

# Tests (extend the two handler test files; keep existing tests)

1. add-book with `hardcover_id` → English edition created via the injected `ensureEnglishEdition`, shelved with `simania_id -383752`, response `resolve_status` `hardcover`; Simania deps not called.
2. Both IDs / neither / `hardcover_id: -1` → 400; duplicate → 409 as for Simania books.
3. book-details with `simania_id: -383752` → English path, no Simania; positive IDs unchanged.

# Acceptance criteria

1. The behavior above; all tests pass.

# Previous attempt (start here)

A previous attempt wrote part or all of this task's work and stopped only because the agent quota ran out. Apply `tasks/sprint-07-english-books/draft/S7-T5-changes.diff.txt` (for example `git apply`), review it against this brief, finish anything missing, then run the verification commands. Do not edit the draft files.
