---
id: S31-T2
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S31-T1
allowed_paths:
  - supabase/functions/_shared/hardcover.ts
  - tests/functions/hardcover-alt-box.test.ts
  - tests/functions/hardcover-match.test.ts
  - tests/functions/hardcover-retry.test.ts
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

`findHardcoverBook` (`supabase/functions/_shared/hardcover.ts`) follows "**Alternative titles in every match (S31).**" and gets a `boxTitle` option for "**Box sets (S31).**". Put no book-specific constants in the code.

# Scope

- **Every pass.** The first pass and the S30 retry both request `{ ids results }` in their one search request. Read `results.hits[].document.id` (a string) and `alternative_titles` (may be missing). A book's title Dice is the maximum over:
  - its title;
  - its title before the first `:`;
  - each of its alternative titles.

  Missing or malformed `results` means no alternative titles. Reuse the S30 code for this instead of keeping two versions.
- **`boxTitle?: boolean`.** When true:
  - drop books whose title has none of `Trilogy`, `Collection`, `Box Set`, `Boxed Set` or `Omnibus` (case-insensitive, whole words);
  - compute title Dice after removing those words from both the query title and the book title;
  - require author evidence, as with `requireAuthor`.
- Everything else (ranking, `0.5` threshold, tie rule, `soundAuthor`, `retryWithAuthor`) is unchanged.

Note: the agent cannot reach Hardcover. The `results` shape was verified live on 2026-11-21: `{ found, hits: [{ document: { id: "488917", title, alternative_titles: [...], author_names, users_count } }] }`.

Reviewer must check: both search query texts request `ids` and `results`, and the parser matches that shape.

# Tests

New `tests/functions/hardcover-alt-box.test.ts`, with fetch stubs only:
1. **Camus.** The search `L'Homme révolté` returns:
   - 488917 `The Rebel` by `Albert Camus`, 407 readers, alternative titles containing `L'Homme révolté`;
   - 1851773 `La révolte: La peste, Les Justes, L'homme révolté` by `Albert Camus`, 1 reader.

   Hint `Albert Camus`: the result is 488917.
2. **Box set.** `findHardcoverBook("The Hunger Games Trilogy", "Suzanne Collins", { boxTitle: true })`, where the search returns 88639 `The Hunger Games` (13743 readers) and 593165 `The Hunger Games Trilogy` (423 readers): the result is 593165.
3. With `boxTitle` and only 88639: `null`.
4. With `boxTitle` and a box book by another author: `null`.
5. With no `results` in the answer, the result is the same as before S31 for the existing `Aurora` and `Paris Apartment` fixtures.

Update the existing stubs in `tests/functions/hardcover-match.test.ts` and `tests/functions/hardcover-retry.test.ts` only as needed for the query now requesting `results`. Their expectations stay the same.

# Acceptance criteria

1. The behavior above; both verification commands pass.
