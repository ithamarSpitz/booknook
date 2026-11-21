---
id: S32-T3
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S32-T1
allowed_paths:
  - supabase/functions/_shared/hardcover.ts
  - tests/functions/hardcover-guards.test.ts
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

`findHardcoverBook` (`supabase/functions/_shared/hardcover.ts`) drops box-set and companion books before ranking. Contract: "**No box set for a single book (S32).**" and "**Companion books (S32).**". The word lists are the generic ones from the contract.

# Scope

- A private `dropUnwanted(books, queryTitle, boxTitle)` applied in every pass (first, retry and box), before ranking:
  - when `boxTitle` is false, drop books whose title has a box word that the query title lacks;
  - always drop books whose title has a companion phrase that the query title lacks.
  - Matching is case-insensitive and on whole words or phrases.
- Ranking, thresholds and everything else are unchanged.

# Tests

New `tests/functions/hardcover-guards.test.ts`, with fetch stubs:
1. Query `Miss Peregrine's Home of Peculiar Children`, author `Ransom Riggs`. The results are 609448 `The Art of Miss Peregrine's Home for Peculiar Children` (3 readers), 609447 `Miss Peregrine's Peculiar Children Boxed Set: 3 Novels` (4 readers) and 438396 `Miss Peregrine's Home for Peculiar Children` (20000 readers). The result is 438396.
2. The same results without 438396: `null`.
3. Query `The Art of Racing in the Rain` keeps a book titled `The Art of Racing in the Rain`.
4. With `boxTitle: true`, `The Hunger Games Trilogy` is still accepted.
5. Query `A Game of Thrones` drops `The World of Ice and Fire: The Untold History of Westeros and the Game of Thrones` and picks `A Game of Thrones`.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
