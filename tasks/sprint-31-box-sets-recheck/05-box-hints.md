---
id: S31-T5
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S31-T1
allowed_paths:
  - public/js/simania.js
  - public/js/recs.js
  - tests/web/box-hints.test.mjs
  - tests/web/match-replay.test.mjs
context:
  - contract
  - architecture.matching
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

The browser follows "**Box-set hints (S31).**". A single book's card is never matched to a Simania box set. Put no book-specific constants in the code; the word lists are the generic ones from the contract.

# Scope

1. `public/js/simania.js`:
   - export `hasHebrewBoxWord(title)` (the contract's Hebrew box words, whole words) and `stripHebrewBoxWords(title)` (removes them, collapses spaces, trims);
   - in `matchHebrewBook`, when the hint title has no Hebrew box word, drop results whose title has one, before ranking. Nothing else in `matchHebrewBook` changes.
2. `public/js/recs.js`, in `localizeRecommendations`: when the card's English title (`rec.title`) has none of `Trilogy`, `Collection`, `Box Set`, `Boxed Set` or `Omnibus` (case-insensitive, whole words), and `stripHebrewBoxWords(hint.title)` is non-empty and differs from `hint.title`, use the stripped title as the hint title. That applies to the S30 omnibus step too.
3. Change nothing else.

# Tests

1. `tests/web/match-replay.test.mjs`: add exactly one expected change. For `hardcover_id` 88639 (`The Hunger Games`), the pick must not be 980165. Every other assertion is unchanged.
2. New `tests/web/box-hints.test.mjs`:
   - `hasHebrewBoxWord` is true for `טרילוגיית משחקי הרעב` and `מארז דיגיטלי – מורשת הותורן`, and false for `סטודיו` and `משחקי הרעב`.
   - `stripHebrewBoxWords("טרילוגיית משחקי הרעב")` is `משחקי הרעב`.
   - `matchHebrewBook("משחקי הרעב", "סוזן קולינס", fake)`, where the search returns 980165 `טרילוגיית משחקי הרעב` and 937027 `משחקי הרעב`, both by `סוזן קולינס`, picks 937027.
   - The same results with hint `טרילוגיית משחקי הרעב` pick 980165, since the hint names a box set.
   - **Localize.** Card `{ title: "The Hunger Games", english_only: true, hebrew_hint: { title: "טרילוגיית משחקי הרעב", author: "סוזן קולינס" } }` with a stub `match`: `match` is called with `משחקי הרעב`.
   - **Localize.** A card titled `The Hunger Games Trilogy` keeps the hint unchanged.

All existing tests pass.

# Acceptance criteria

1. The behavior above; `npm run test:web` passes.
