---
id: S21-T5
stage: 4
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S21-T3
allowed_paths:
  - public/js/recs.js
  - tests/web/recs.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

The browser never links an English book to a Hebrew edition whose author is clearly someone else. Example: Blue Exorcist linked to The Exorcist.

# Scope

Contract: "Author guard (browser, S21)".

In `localizeRecommendations` in `public/js/recs.js`, right before the single `link-edition` call in `one(rec)`:
- get the chosen edition's Simania author from the payload or search result already in hand (no extra request);
- if `authorGuardRejects(simaniaAuthor, englishAuthors, rec.hebrew_author ?? "")` is true, return without linking. `englishAuthors` is `rec.author` split on commas, trimmed, with empty parts dropped.

This covers the title path, the author path and the fallback alike. Nothing else changes.

# Tests (`tests/web/recs.test.mjs`)

1. A title-path match whose Simania author is וויליאם פיטר בלאטי for a card by Kazue Kato makes no `link-edition` call and leaves the card English-only.
2. ג'ו היל for "Joe Hill" links as before.
3. A card whose `hebrew_author` agrees with the Simania author links even with a low sound score.
4. A Latin or empty Simania author links as before.
5. Existing tests pass.

# Acceptance criteria

1. The behavior above; `test:web` passes.
