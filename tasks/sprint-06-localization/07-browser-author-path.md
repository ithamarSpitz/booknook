---
id: S6-T7
stage: 4
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S6-T4
  - S6-T6
allowed_paths:
  - public/js/simania.js
  - public/js/recs.js
  - public/js/contract.js
  - tests/web/simania.test.mjs
  - tests/web/recs.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

When the title match misses, the browser finds the Hebrew edition through the author: Simania author search, then `match-by-author`, then the existing `link-edition`.

# Why (live evidence, Nov 2026)

Spin by Robert Charles Wilson: Simania has "סחרור" (97171) by "רוברט צ'רלס וילסון"; Wikidata spells the author "רוברט צ'ארלס וילסון", so an exact name search returns nothing, while a search for the first and last words, "רוברט וילסון", returns סחרור among Wilson's books.

# Scope

1. `public/js/simania.js`: export `searchByAuthor(hebrewAuthor, fetchImpl = fetch)`: words of the name (split on whitespace); empty → `[]`. Query = first word + " " + last word (one word → that word). One `books_search` call with `limit: 50, offset: 0` (reuse the existing call helper). Keep results whose title contains a Hebrew letter and whose author has `similarity(hebrewAuthor, author) >= 0.6`; return at most 8 as `{ simania_id, title, author }`.
2. `public/js/contract.js`: add `MATCH_BY_AUTHOR: "match-by-author"` to `FUNCTIONS`, and `hebrew_author` to the RecommendationCard JSDoc.
3. `public/js/recs.js`:
   - The API-card mapping (`recommendationFromApiCard`) keeps `hebrew_author` (string or null) for cards without `simania_id`.
   - `localizeRecommendations`: queue English-only cards that have a `hebrew_hint` title or a `hebrew_author`. For each: try the title match exactly as today. If it yields no Simania id and `hebrew_author` is set: `searchByAuthor` → if candidates, call `MATCH_BY_AUTHOR` with `{ work_id, candidates }` → if it returns a `simania_id`, fetch that edition's payload (existing `fetchPayload`) and call `LINK_EDITION` with `source` = returned `resolve_status` (`fuzzy` → `"nli"`), then `onLinked` as today. Make `searchByAuthor` injectable through `deps` like `match`. Failures are caught per card as today. Concurrency stays 3.

No change to markup, CSS or other modules.

# Tests

- `tests/web/simania.test.mjs`: `searchByAuthor("רוברט צ'ארלס וילסון", fakeFetch)` sends query "רוברט וילסון" with limit 50 and returns סחרור (author "רוברט צ'רלס וילסון") but not "עונש מוות" by "רוברט וילסון" (similarity below 0.6 is fine to assert by expected output) or English-titled results; empty name → no call.
- `tests/web/recs.test.mjs`: (1) title match succeeds → author path not used; (2) title miss + `hebrew_author` → `match-by-author` called with the candidates, then `link-edition` with the returned id and source, then `onLinked`; (3) `match-by-author` returns null → no `link-edition`; (4) card with only `hebrew_author` (no hint) is processed; (5) `resolve_status` "fuzzy" is sent as "nli".

# Acceptance criteria

1. The behavior above; `npm run test:web` passes.
