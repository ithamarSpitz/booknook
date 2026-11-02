---
id: S6-T3
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S6-T1
allowed_paths:
  - supabase/functions/_shared/bridges.ts
  - tests/functions/author-bridges.test.ts
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

Two Wikidata author-name bridges in `supabase/functions/_shared/bridges.ts`: English → Hebrew and Hebrew → English author names.

# Why (live evidence, Nov 2026)

The Hebrew author name unlocks Simania's author search, which finds Hebrew editions that title bridges miss: "פרדריק בקמן" → איש ושמו אובה (A Man Called Ove), "סטייסי ווילינגהם" → הבהוב באפלה (A Flicker in the Dark). The English name fixes Hardcover matches when NLI gives only a Hebrew creator (David Koepp's Aurora).

# Scope

Add two exported functions, both returning null on any error (never throw), using the existing `providerFetch` and Wikidata helpers:

1. `wikidataHebrewAuthor(englishName: string): Promise<string | null>`: one `wbsearchentities` search (`language=en`, `type=item`, `limit=5`) for the name; for results in order whose label has normalized Dice 1 with the name (at most 3 entity reads), fetch the entity; return the Hebrew label of the first that is a human (P31 includes `Q5`) and has a Hebrew label. Empty name → null.
2. `wikidataEnglishAuthor(hebrewName: string): Promise<string | null>`: one search with `language=he`; for results in order (at most 3 entity reads), return the English label of the first human whose Hebrew label has Dice at least 0.8 with the name. Empty name → null.

Do not change other functions.

# Tests

New `tests/functions/author-bridges.test.ts`, stubbed `fetch`:

1. "Fredrik Backman" → human with he label "פרדריק בקמן" → returns it; a non-human first result (a film) is skipped.
2. No exact-label result → null; a human without a Hebrew label → null.
3. `wikidataEnglishAuthor("דיוויד קופ")` → "David Koepp" for a human with he label "דיוויד קופ"; a human whose he label is "דוד בן גוריון" is skipped.
4. Fetch failure → null for both.

# Acceptance criteria

1. The behavior above, all tests passing.
