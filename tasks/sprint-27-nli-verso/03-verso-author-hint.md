---
id: S27-T3
stage: 3
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S27-T2
allowed_paths:
  - supabase/functions/_shared/catalog.ts
  - tests/functions/author-hint.test.ts
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

In `ensureResolved` (`supabase/functions/_shared/catalog.ts`), the NLI Hardcover match uses the bridge's `versoAuthor` as the author hint, in the order from the contract paragraph "**NLI title page verso (S27).**":
1. the catalog hint;
2. `versoAuthor`;
3. the Wikidata author bridge;
4. the NLI creator.

# Scope

- Change only the hint selection in the NLI path.
- When `versoAuthor` is used, make no `wikidataEnglishAuthor` request.

# Tests

In `tests/functions/author-hint.test.ts`, with fake providers:

1. With no catalog hint and the bridge `{ title: "Secrets", author: "ווילסון, ג'קלין", versoAuthor: "Jacqueline Wilson" }`, `findHardcoverBook` gets `("Secrets", "Jacqueline Wilson")`, and `wikidataEnglishAuthor` is not called.
2. A catalog hint wins over `versoAuthor`.
3. Without `versoAuthor`, the existing order is unchanged.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
