---
id: S17-T6
stage: 3
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S17-T3
allowed_paths:
  - public/js/data.js
  - public/js/library.js
  - public/css/base.css
  - tests/web/data.test.mjs
  - tests/web/library.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

On the library screen, the reader can hide a genre shelf with one tap, pinned shelves are marked, and a pinned genre with few books still shows with a note.

# Scope

Contract: "Reading them (browser)" (genre keys, empty pinned shelves), "Hiding a genre shelf (browser, S17)", and `GenreShelf`.

1. `public/js/data.js`: load `genre_key` with the genre rows and the caller's `genre_preferences`, and build `GenreShelf` objects `{ genre_key, genre, pinned, books }`. Add an empty shelf for each pinned genre with no rows.
2. `public/js/library.js`:
   - The "הסתר מדף" button in each genre shelf header, with the call, disabling, toast, removal and `notifyRecsInputsChanged()` the contract describes.
   - The "נעוץ" label.
   - The few-books note for pinned shelves under 4 books.
   - The existing genre tile, localization and card code stays as it is.
3. `public/css/base.css`: small secondary styles for the button, label and note inside `.genre-shelf .shelf-head`. They must work in the wood-shelf layout and at phone width. Do not touch other rules.

# Tests

1. `data.test.mjs`: shelves carry `genre_key` and `pinned`; an empty pinned shelf is added after the stored ones.
2. `library.test.mjs`:
   - "הסתר מדף" calls `set_genre_preference` with `(genre_key, genre, 'hidden')`. On success the section is removed and `RECS_INPUTS_CHANGED` fires once; on failure the section stays and the button re-enables.
   - "נעוץ" shows only on pinned shelves; the note shows only on pinned shelves with fewer than 4 books.
3. Existing tests pass.

# Acceptance criteria

1. The behavior above; `test:web` passes.
