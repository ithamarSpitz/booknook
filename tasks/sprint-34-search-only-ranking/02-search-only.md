---
id: S34-T2
stage: 2
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S34-T1
allowed_paths:
  - supabase/functions/_shared/hardcover.ts
  - supabase/functions/_shared/catalog.ts
  - tests/functions/search-only-ranking.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Hardcover matching ranks from the search documents, and the full details are fetched only when a new work is written. Contract: "**Search-only ranking (S34).**" and "**Details only for a new work (S34).**".

# Scope

1. In `supabase/functions/_shared/hardcover.ts`, change `searchHardcoverDetails`:
   - Request `search(...) { ids results }` as today.
   - For each ID, in `ids` order, build a `HardcoverBook` from the hit document whose `document.id` equals it:
     - `id` (as a number), `title` and `slug`;
     - `users_read_count`, defaulting to 0;
     - `cached_contributors`, one `{ author: { name } }` per `contributions[]` entry in order;
     - `image` (`{ url }` or null).
     - Do not set `cached_similar_book_ids` or `cached_tags`; leave them `undefined`.
   - Fallback: if any ID has no document, call `hardcoverBooks(ids)` exactly as today. Existing test stubs that return only `ids` keep working.
   - Ranking, guards and alternative titles are unchanged.
2. In `supabase/functions/_shared/catalog.ts`:
   - Add `hardcoverBooks` to `CatalogProviders` and its defaults, so tests can override it.
   - In `ensureResolved`, before `upsertWork`, check the match. If `cached_similar_book_ids` is `undefined`, call `api.hardcoverBooks([match.id])` once and pass that book to `upsertWork`.
   - If that call throws or returns no book, write no work and set the status to `pending`, as for a provider failure.
   - `resolveMatch` itself never calls `hardcoverBooks`.

# Tests

New `tests/functions/search-only-ranking.test.ts`, with fetch stubs (no network). Count `books(` requests in the stub:
1. A search response with `ids` and full `results.hits[].document`. `findHardcoverBook("Peter Pan", "J. M. Barrie")` picks the document with the most readers among exact titles, and makes 0 `books(` requests.
2. The same, but one ID has no document: exactly 1 `books(` request, and the same pick as when every book comes from the details.
3. `ensureResolved` with a stubbed `resolveMatch` path: the match is built from documents, and the `hardcoverBooks` override returns a book with `cached_similar_book_ids: [1,2]`. `upsertWork` receives the similar IDs [1,2], and `hardcoverBooks` is called once.
4. `hardcoverBooks` throws: the edition becomes `pending` and no work is written.
5. A match that already has `cached_similar_book_ids` (built from details): `hardcoverBooks` is not called.

Existing tests pass unchanged.

# Acceptance criteria

1. The behavior above; both verification commands pass.
