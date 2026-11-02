---
id: S6-T2
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/functions/_shared/hardcover.ts
  - supabase/functions/_shared/catalog.ts
  - tests/functions/hardcover-match.test.ts
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

Hebrew → Hardcover resolution never links a book to a different book: the direct fuzzy path needs author evidence, and a tie between same-title books with no author evidence is "no match", not a popularity pick.

# Why (live evidence, Nov 2026)

- "נערה בנוף" by ג'ונתן לת'ם (Simania 34027) is linked to Hardcover 483014 "נערה, מופרעת" (Girl, Interrupted, Susanna Kaysen): no bridge matched, the direct fuzzy path compared the Hebrew title with a Hebrew-titled Hardcover book (Dice 0.5 ≥ 0.5) with no author check. The right book is Girl in Landscape (473787).
- "כיבוי אורות" by דיוויד קופ (Simania 1013521) is linked to 372879 "Aurora" by Kim Stanley Robinson: NLI gave "Aurora", the author hint was Hebrew (no boost), and the most popular "Aurora" won. David Koepp's Aurora is 559469.

# Scope

1. `findHardcoverBook(originalTitle, authorHint = "", options?: { requireAuthor?: boolean })` in `supabase/functions/_shared/hardcover.ts` (contract "Hardcover match"):
   - Keep the search, ranking and the 0.50 title threshold.
   - Ambiguity: if the top ranked book got no author boost and another returned book whose first contributor name differs (normalized) has the same title Dice as the top book, return null.
   - `requireAuthor: true`: accept the top book only if it got the author boost (a contributor name with Dice > 0.45 against a non-empty hint); otherwise return null.
2. `supabase/functions/_shared/catalog.ts`, `ensureResolved`: the direct fuzzy call passes `{ requireAuthor: true }`. Bridge paths (Wikidata, NLI) do not.

Keep every other behavior (statuses, `pending` on provider failure, match title, English author hint).

# Tests

New `tests/functions/hardcover-match.test.ts`, stubbed `fetch` (GraphQL search + books responses inline):

1. "Aurora" with results Kim Stanley Robinson (popular) and David Koepp, hint "קופ, דוד" (no boost) → null.
2. Same results, hint "David Koepp" → 559469.
3. "Paris apartment" with four "The Paris Apartment" books, hint "Lucy Foley" → Foley's.
4. Single clear result with no author boost → still accepted (no tie).
5. `requireAuthor`: "נערה בנוף" vs a Hebrew-titled "נערה, מופרעת" by Susanna Kaysen, hint "ג'ונתן לת'ם" → null.
6. `ensureResolved` (fake DB, provider overrides) calls the fuzzy `findHardcoverBook` with `{ requireAuthor: true }`.

# Acceptance criteria

1. The behavior above, all tests passing, existing tests unchanged except where they relied on a popularity pick between same-title books (update those only to the new rule, and say so in OPEN_ISSUES).
