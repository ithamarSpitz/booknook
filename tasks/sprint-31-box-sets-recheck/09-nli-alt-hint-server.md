---
id: S31-T9
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S31-T1
allowed_paths:
  - supabase/functions/recommendations/index.ts
  - supabase/functions/_shared/types.ts
  - public/js/contract.js
  - tests/functions/nli-alt-hint.test.ts
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

`defaultHebrewHint` (`supabase/functions/recommendations/index.ts`) also returns the NLI Hebrew title as an alternate when the hint comes from Wikidata. Contract: "**NLI alternate hint (S31).**". It is used by both the `recommendations` and `genre-hint` functions. Put no book-specific constants in the code.

# Scope

- `HebrewHint` (`supabase/functions/_shared/types.ts`) gets an optional `alternate?: string | null`. Mirror it in the JSDoc type in `public/js/contract.js` if `HebrewHint` is described there.
- In `defaultHebrewHint`, when `wikidataHebrew` returns a hint:
  - also call `nliHebrew(book.title, author)`;
  - when it returns a title whose normalized form differs from the Wikidata title's, set `alternate` to it;
  - otherwise leave `alternate` out (or null).
  - An NLI failure leaves the Wikidata hint unchanged.
- When the hint comes from NLI, there is no `alternate`.
- Change nothing else.

# Tests

New `tests/functions/nli-alt-hint.test.ts`. Call `defaultHebrewHint` with the bridge functions stubbed (inject them if the function has no seam; add the smallest optional parameter needed and keep the existing callers unchanged):
1. Wikidata `בית קברות לחיות` and NLI `בית כברות לחיות` give `{ source: "wikidata", title: "בית קברות לחיות", alternate: "בית כברות לחיות" }`.
2. NLI returns the same title (after normalization): no `alternate`.
3. NLI throws: the Wikidata hint with no `alternate`.
4. No Wikidata hit, NLI hit: `{ source: "nli", ... }` with no `alternate`, and NLI is called once.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
