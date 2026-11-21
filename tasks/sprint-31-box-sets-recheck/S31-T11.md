---
id: S31-T11
stage: 3
model_class: worker
timeout_minutes: 20
review: true
allow_protected: false
depends_on:
  - S31-T2
allowed_paths:
  - supabase/functions/_shared/hardcover.ts
  - tests/functions/author-initials.test.ts
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

The Hardcover author boost treats initials the same however they are written. Put no book- or author-specific constants in the code.

Live case, 2026-11-21:
- NLI bridges Simania 962748 `תיכון לילה` to `Night school`, and the Wikidata author bridge gives `CJ Daugherty`.
- The S30 retry search returns 61420 `Night School` by `C.J. Daugherty`.
- `similarity("CJ Daugherty", "C.J. Daugherty")` is below `0.45`, so the boost is `0` and the required author evidence fails.

# Scope

- In `authorBoost` (`supabase/functions/_shared/hardcover.ts`), compare a canonical form of both names, besides the existing comparison. In that form:
  - every run of single-letter words, with or without dots, is joined into one word (`C.J.`, `C. J.`, `C J` and `CJ` all become `cj`);
  - case and dots are ignored.
- The boost applies when either the existing check or the canonical check gives `similarity > 0.45`. Nothing else changes.

# Tests

New `tests/functions/author-initials.test.ts`, with a fetch stub:
1. `findHardcoverBook("Night school", "CJ Daugherty", { retryWithAuthor: true })`:
   - the first search returns 2 books titled `Night School` by other authors;
   - the retry search returns 61420 `Night School` by `C.J. Daugherty`;
   - the result is 61420.
2. These pairs boost: `J.K. Rowling` / `J. K. Rowling`, `JRR Tolkien` / `J.R.R. Tolkien`.
3. `CJ Daugherty` vs `Christopher Paolini` does not boost.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
