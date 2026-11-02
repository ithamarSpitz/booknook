---
id: S6-T1
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/functions/_shared/bridges.ts
  - tests/functions/wikidata-hebrew.test.ts
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

`wikidataHebrew(title, author)` (the recommendations' English → Hebrew title lookup in `supabase/functions/_shared/bridges.ts`) finds the Hebrew title when Wikidata lists edition items above the work, checks the author, and returns a clean Hebrew title.

# Why (live evidence, Nov 2026)

- English search "Spin" (limit 10) returns: Spin magazine, a Darren Hayes album, piano, spinach, Q87484739 "Spin, original Tor hardcover edition", meningitis, Q64706695 "Spin, Star Trek novel", two more Spin editions. The work Q2301398 (Robert Charles Wilson's novel, Hebrew label "סחרור") is not in the results; its edition Q87484739 is (P629 = Q2301398). Today edition items are rejected (no Hebrew label, not a work type), so the lookup returns null and the card stays English.
- For "The Dead Zone" the Hebrew label is "האזור המת (ספר)"; the "(ספר)" Wikipedia disambiguation breaks the Simania title match.

# Scope

Only `wikidataHebrewLookup` (and private helpers) in `bridges.ts`, following the contract section "Wikidata Hebrew title (reverse direction)":

1. Keep the search (`language=en`, `limit=10`) and the ranking (title Dice * 3 + 2 when the author appears in the description). Still inspect at most the first 4 ranked results.
2. For each inspected result: fetch the entity. If it has a P629 claim, fetch the first P629 entity and use it as the candidate work instead (at most one extra entity read per inspected result). Skip a work you already checked.
3. Apply the existing written-work check to the candidate work. If the work has P50 claims and the author hint is non-empty, read the English labels of at most the first two P50 authors and accept only if one has Dice greater than 0.45 with the author hint; otherwise skip.
4. Hebrew title: the work's Hebrew label with a trailing ` (...)` part removed (repeat while one remains; keep the label if that would empty it). Skip if empty.
5. Return `{ title, author, source: "Wikidata" }` exactly as today (author = Hebrew label of the first P50 author, current helper). `wikidataHebrew` still returns null on any error.

Bounds: at most 1 search + 4 × (1 entity + 1 P629 entity + 2 author reads) + 1 Hebrew author read. Do not change `wikidataOriginal`, NLI code or other files.

# Tests

New `tests/functions/wikidata-hebrew.test.ts`, stubbed `fetch` with inline JSON (no live calls):

1. Search returns an edition item with P629 → work with `he` label "סחרור" and P50 author whose English label is "Robert Charles Wilson": `wikidataHebrew("Spin", "Robert Charles Wilson")` returns title "סחרור".
2. Same, but the work's author is "William Shatner": returns null (author mismatch), and a later valid result is still used if present.
3. Hebrew label "האזור המת (ספר)" → title "האזור המת".
4. A work without P50 is accepted on the written-work check alone (no author check).
5. A fetch failure → null.

# Acceptance criteria

1. The behavior above, all tests passing, existing tests unchanged.
