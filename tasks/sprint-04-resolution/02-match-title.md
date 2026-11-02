---
id: S4-T2
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/functions/_shared/catalog.ts
  - tests/functions/match-title.test.ts
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

Resolution ignores Simania edition labels in titles, so books like "חפצים חדים (2015)" resolve.

# Why (live evidence, Nov 2026)

These shelved editions are stored as `not_found` only because their Simania titles carry edition labels that the resolver sends to Wikidata, NLI and Hardcover: `חפצים חדים (2015)`, `ההיסטוריה הסודית [מהדורת מודן - 2015]`, `הנסיכה הקסומה [מהדורת 2018]`, `מחר ועוד מחר ועוד מחר [עטיפה חדשה]`, `עין החתול [מהדורת 2011]`. With the labels removed, the current resolver matches all five live (Sharp Objects 130839, The Secret History 166849, The Princess Bride 283102, Tomorrow, and Tomorrow, and Tomorrow 479910, Cat's Eye 94555).

# Scope

In `supabase/functions/_shared/catalog.ts`:

1. Export a pure function `matchTitle(title: string): string`: trim; then repeatedly remove a final parenthesized part `( ... )` or a final bracketed part `[ ... ]` (with the whitespace before it) and trim again, until neither is at the end. If the result is empty, return the trimmed input. Do not touch parentheses or brackets that are not at the end.
2. In `ensureResolved`, compute `matchTitle(edition.title)` once and use it everywhere the edition title is sent to a provider: `wikidataOriginal`, `nliOriginal`, and the direct fuzzy `findHardcoverBook` call. Never change the stored `title`.

Nothing else changes (statuses, retries, `pending` on provider failure, work upsert).

# Tests

New file `tests/functions/match-title.test.ts`:

1. `matchTitle` on each of the five live titles above returns the clean title (`חפצים חדים`, `ההיסטוריה הסודית`, `הנסיכה הקסומה`, `מחר ועוד מחר ועוד מחר`, `עין החתול`).
2. Two labels: `ספר (2010) [מהדורה חדשה]` → `ספר`. A title with no label is unchanged. A middle parenthesis `ספר (א) של אחר` is unchanged. `(2015)` alone → `(2015)`. Trailing spaces (`'ואם היו אומרים לך '`) are trimmed.
3. `ensureResolved` (use the existing fake DB helper in `tests/functions/helpers/fake-db.ts` and provider overrides, like `tests/functions/add-book-catalog.test.ts`): for an edition titled `חפצים חדים (2015)`, `wikidataOriginal`, `nliOriginal` and the fuzzy `findHardcoverBook` receive `חפצים חדים`, and the stored edition title stays `חפצים חדים (2015)`.

# Acceptance criteria

1. The behavior above, with all tests passing, including the existing catalog tests.
