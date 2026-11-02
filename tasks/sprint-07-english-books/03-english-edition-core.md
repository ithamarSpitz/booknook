---
id: S7-T3
stage: 1
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/functions/_shared/english.ts
  - supabase/functions/_shared/hardcover.ts
  - supabase/functions/_shared/catalog.ts
  - tests/functions/english.test.ts
context:
  - contract
  - architecture.functions
  - architecture.data_model
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Shared server code for English editions (books not on Simania, taken from Hardcover): search, field mapping, and create/refresh.

# Scope

Contract: `editions` "English editions" and `search-english`.

1. `supabase/functions/_shared/hardcover.ts`: export `hardcoverEnglishBooks(ids)` that fetches, in one GraphQL batch, everything `hardcoverBooks` fetches plus `description rating ratings_count pages release_year default_physical_edition { pages publisher { name } }`. Do not change `hardcoverBooks` or `findHardcoverBook`.
2. `supabase/functions/_shared/catalog.ts`: move the work upsert out of `ensureResolved` into an exported `upsertWork(db, book, now)` that returns the work id, and use it in `ensureResolved` (same behavior).
3. New `supabase/functions/_shared/english.ts`:
   - `englishEditionId(hardcoverId)` = `-hardcoverId`; `isEnglishEdition(simaniaId)` = `simaniaId < 0`.
   - `htmlToText(html)`: the contract's description rule.
   - `englishEditionFields(book)`: the display fields per the contract.
   - `searchEnglish(query, deps?)` returning `EnglishBook[]` per the contract (Hardcover search `per_page=8`, one batch read, search order).
   - `ensureEnglishEdition(db, hardcoverId, deps?, now?)` returning `EditionRow`: if edition `-hardcoverId` exists with `details_at` under 30 days old, return it; otherwise fetch the book (`hardcoverEnglishBooks([id])`; none → throw `HttpError(404, "Book not found on Hardcover.")`), `upsertWork`, upsert the edition (`simania_id = -id`, `work_id`, `resolve_status: "hardcover"`, `resolved_at` and `details_at` now, the display fields) and return it. Provider failure → `HttpError(502, ...)`. Providers injectable for tests.

# Tests (new `tests/functions/english.test.ts`, stubbed fetch and fake DB, no live calls)

1. `htmlToText` on a real-style description (`<p><b>Now in…</b><br><br>One night…</p>`) gives plain text with newlines, no tags; entities decoded.
2. Field mapping: authors joined, rating rounded to 2 decimals, pages fallback to the physical edition, nulls when missing.
3. `ensureEnglishEdition`: creates work + edition `-383752` linked with status `hardcover`; a fresh row is returned without a provider call; a 31-day-old row is refreshed; unknown id → 404.
4. `searchEnglish`: short query → `[]` with no call; results keep search order and map fields.
5. `ensureResolved` behavior unchanged (existing tests pass).

# Acceptance criteria

1. The behavior above; all tests pass.
