---
id: S6-T5
stage: 3
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S6-T2
  - S6-T3
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

When the catalog cannot supply an English author for the NLI path, use the Wikidata author bridge, so Hardcover picks the right same-title book.

# Why (live evidence, Nov 2026)

"כיבוי אורות" by דיוויד קופ: NLI gives "Aurora"; with no English author, the new ambiguity rule (S6-T2) correctly refuses to choose between Kim Stanley Robinson's and David Koepp's Aurora. With the English name "David Koepp" from Wikidata, Hardcover returns David Koepp's Aurora (559469).

# Scope

In `supabase/functions/_shared/catalog.ts`, `ensureResolved`, NLI path only: the author hint is the existing catalog `englishAuthorHint(...)`; if that is null, `providers.wikidataEnglishAuthor(edition.author)` (add `wikidataEnglishAuthor` from `bridges.ts` to the providers/overrides object, default the real function); if that is null too, the NLI creator as today. Call the Wikidata author bridge only when the NLI bridge exists and the catalog hint is null.

# Tests

Extend `tests/functions/author-hint.test.ts` (keep existing tests):

1. No catalog hint, `wikidataEnglishAuthor` returns "David Koepp" → `findHardcoverBook("Aurora", "David Koepp")`.
2. Catalog hint present → `wikidataEnglishAuthor` is not called.
3. Both null → the NLI creator is the hint.
4. Wikidata path and fuzzy path never call `wikidataEnglishAuthor`.

# Acceptance criteria

1. The behavior above, all tests passing.
