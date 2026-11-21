---
id: S40-T2
stage: 2
model_class: worker
timeout_minutes: 40
review: true
depends_on:
  - S40-T1
allowed_paths:
  - scripts/lib/rematch.ts
  - scripts/rematch-cached.ts
  - tests/functions/rematch-author-agreement.test.ts
  - tests/functions/rematch-lib.test.ts
  - tests/functions/rematch-cached.test.ts
  - tests/functions/rematch-from-file.test.ts
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

Contract: "**Rematch author agreement (S40).**". The browser's title-match verification already has this safeguard. Real case: Spare was proposed with the Simania book `Wikipedia` by Dan O'Sullivan, because Wikidata's Hebrew label for Spare is `wikipedia`.

# Scope

1. **`scripts/lib/rematch.ts`:** export two functions.
   - `authorVariants(name)` returns, without duplicates and empty strings:
     - the name with every `(...)` group removed and whitespace collapsed;
     - the name with every `word (alt)` replaced by `alt`.
   - `authorAgreesWithWork(hebrewAuthor, englishAuthors, knownHebrewNames)` is true when, for some variant `v`:
     - `nameSoundScore(v, englishAuthors) >= 0.7`, or
     - `similarity(v, h) >= 0.6` for some `h` in `knownHebrewNames`.

     It is false for an empty `hebrewAuthor`.
2. **`confirmCandidate`:** gains an `authorAgrees: boolean` input. When it is false: `accepted: false`, `failed: false`, and `resolveMatch` is not called.
3. **`scripts/rematch-cached.ts`:**
   - Computes `authorAgrees` for every candidate, including dictionary picks, from the edition's `author` and the authors-table Hebrew names of all the work's `original_authors`.
   - When no candidate is accepted and one was refused for this reason, the skip reason is `author_mismatch`, counted on its own.
   - `--from` checks each saved proposal the same way, using the author from the database row or from Simania details. A failing proposal is skipped as `author_mismatch` and not linked.

If a test outside `allowed_paths` fails, stop and report it; do not edit it.

# Tests

New `tests/functions/rematch-author-agreement.test.ts`, with real 2026-11-21 cases:
1. `authorAgreesWithWork("Dan O'Sullivan", ["Prince Harry", "J.R. Moehringer"], [])` is false.
2. `authorAgreesWithWork("אמיל זולא (זולה)", ["Émile Zola"], [])` is true (0.75 on a variant).
3. `authorAgreesWithWork("סטיב טולץ", ["Steve Toltz"], [])` is true (0.73).
4. `authorAgreesWithWork("סטפן (שטפן) צווייג (צוויג)", ["Stefan Zweig"], ["סטפן צוויג"])` is true (table name).
5. `authorVariants("תומאס (תומס) הארדי (הרדי)")` contains `תומאס הארדי` and `תומס הרדי`.
6. CLI: a candidate whose author doesn't agree → `author_mismatch`, with no `resolveMatch` call (counter).
7. `--from`: a saved proposal whose edition author is `Dan O'Sullivan` for a work by Prince Harry → `author_mismatch`, with no `applyRepair`.

Existing tests pass. Update them only where `confirmCandidate`'s new input changes a call.

# Acceptance criteria

1. The behavior above; both verification commands pass.
