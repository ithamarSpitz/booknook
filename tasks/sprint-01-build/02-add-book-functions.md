---
id: S1-T2
stage: 1
model_class: hard_worker
timeout_minutes: 45
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/functions/add-book/**
  - supabase/functions/book-details/**
  - supabase/functions/resolve-book/**
  - supabase/functions/search-books/**
  - supabase/functions/_shared/simania.ts
  - supabase/functions/_shared/catalog.ts
  - tests/functions/add-book*.test.ts
  - tests/functions/book-details*.test.ts
  - tests/functions/search-books*.test.ts
  - tests/functions/helpers/**
  - tests/functions/fixtures/simania/**
  - tests/functions/fixtures/wikidata/**
  - tests/functions/fixtures/nli/**
context:
  - contract
  - architecture.functions
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Implement `add-book` and `book-details`, retire `resolve-book`, and keep `search-books` working, per the contract.

# Required context

`docs/contract.md` (function I/O), `docs/architecture/functions.md`, `matching.md`. Existing `_shared/bridges.ts`, `simania.ts`, `hardcover.ts`, `db.ts`, `types.ts`.

# Scope

1. `_shared/simania.ts`: add `bookDetails(id)` and `bookRating(id)` over the Simania MCP tools `books_get_details` and `books_get_rating`.
2. `_shared/catalog.ts`: `ensureEdition(simaniaId)` (upsert editions with the 30-day freshness rule) and `ensureResolved(edition)` (resolve with the existing Wikidata → Hardcover → NLI chain, upsert works, the 14-day `not_found` retry rule). Both take the DB client as a parameter so tests can pass a fake.
3. `add-book/index.ts`, `book-details/index.ts` per the contract. `add-book` never fails because resolution failed.
4. Delete `resolve-book/`.
5. `search-books`: require a valid user; behavior otherwise unchanged.
6. Deno tests with stubbed `fetch` and a fake DB client: details fetch and upsert, freshness skip, resolve success via Wikidata, NLI fallback, `not_found` cached, duplicate add returns 409, unauthenticated returns 401.

# Out of scope

`recommendations/**`, `_shared/hardcover.ts`, `_shared/bridges.ts`, `_shared/types.ts`, `_shared/db.ts`, migrations, web.

# Invariants

- No live network calls in tests.
- Display text stored exactly as Simania returns it.
- If you need a change in a file you do not own, stop and report it.

# Acceptance criteria

1. Type check and tests pass.
2. Responses match the contract types exactly.
