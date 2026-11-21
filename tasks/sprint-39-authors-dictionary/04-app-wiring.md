---
id: S39-T4
stage: 4
model_class: worker
timeout_minutes: 40
review: true
depends_on:
  - S39-T3
allowed_paths:
  - supabase/functions/recommendations/index.ts
  - supabase/functions/genre-hint/index.ts
  - supabase/functions/_shared/catalog.ts
  - supabase/functions/link-edition/index.ts
  - tests/functions/authors-wiring.test.ts
  - tests/functions/recommendations-logic.test.ts
  - tests/functions/resolve-match.test.ts
  - tests/functions/link-edition-handler.test.ts
  - tests/functions/recommendations-handler.test.ts
  - tests/functions/author-hint.test.ts
  - tests/functions/resolver-s30.test.ts
  - tests/functions/box-sets.test.ts
  - tests/functions/prefix-weak.test.ts
  - tests/functions/add-book-catalog.test.ts
context:
  - contract
  - architecture.matching
  - architecture.functions
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Contract: "**Authors table (S39).**" (Edge Functions). Every Edge Function author lookup goes through the authors table.

# Scope

1. `hebrewAuthorFor` (`supabase/functions/recommendations/index.ts`), used by recommendations and `genre-hint`:
   - Replace the linked-editions query and the direct Wikidata call with `hebrewNames(catalogAuthorStore(db), englishAuthor)`. Return its first name, or null.
   - A thrown error still gives null for this request, but it is not cached in the in-request `cache` map, so a later call in the same request may retry.
   - Keep the function's signature. The `wikidataHebrewAuthor` dependency becomes the strict lookup, passed through to `hebrewNames`.
2. `resolveMatch` (`supabase/functions/_shared/catalog.ts`): when `englishAuthorHint` gives null, replace `api.wikidataEnglishAuthor(edition.author)` with `englishNames(catalogAuthorStore(db), edition.author, { wikidataEnglishAuthorStrict: api.wikidataEnglishAuthor ... })`, using its first name. A thrown error still counts in `failures`, as today.
   - `CatalogProviders.wikidataEnglishAuthor` stays injectable for tests.
   - Leave `englishAuthorHint` itself unchanged.
3. `link-edition`: after a successful link of a positive `simania_id` (not a same-book duplicate), call `recordPair(catalogAuthorStore(db), edition.author, <the work's first original author>)`.
   - Read the work row that the handler already uses, or one extra select.
   - A failure there is logged and ignored. It never changes the response.

# Tests

New `tests/functions/authors-wiring.test.ts`, plus updates only where existing tests stub the old queries:
1. `hebrewAuthorFor` with the table holding `וולי למב` for Wally Lamb → that name, with no Wikidata call.
2. `hebrewAuthorFor` for Alice Feeney with a linked edition by `הולי ג'קסון` and no table row → Wikidata is called, not the edition author.
3. Wikidata throws in `hebrewAuthorFor` → null, and a second call in the same request calls Wikidata again.
4. `resolveMatch` uses the table's English name as the hint when `englishAuthorHint` is null.
5. A successful `link-edition` records the pair, and a failing `recordPair` still returns success.

All existing tests pass. Existing tests that expect the old behavior (the linked-editions author lookup in `hebrewAuthorFor`, or a direct `wikidataEnglishAuthor` call in `resolveMatch`) must be updated to the new behavior, keeping what they check otherwise: the case, the inputs, and the expected Hebrew or English name, now provided through the authors-table stub. Measured: attempt 2 was blocked by 4 such tests in `tests/functions/recommendations-handler.test.ts`. Don't delete tests.

# Acceptance criteria

1. The behavior above; both verification commands pass.
