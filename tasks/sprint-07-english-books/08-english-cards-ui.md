---
id: S7-T8
stage: 4
model_class: worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on:
  - S7-T1
  - S7-T5
  - S7-T6
  - S7-T7
allowed_paths:
  - public/js/card.js
  - public/js/recs.js
  - public/js/library.js
  - public/css/base.css
  - tests/web/card.test.mjs
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

English editions display correctly everywhere, and English-only recommendations can be added to a shelf.

# Scope

1. `public/js/card.js` (book card overlay), for a book with `english_edition` (or `simania_id < 0`):
   - Rating line says `דירוגים ב־Hardcover` instead of `דירוגים בסימניה`, and the empty state says `אין עדיין דירוגים ב־Hardcover`.
   - Title, author and description elements get `dir="auto"` so English reads left-to-right; the rest of the layout stays as is.
   - Opening it never triggers a Simania call (the `book-details` call with the negative ID is fine).
2. `public/js/recs.js`:
   - English-only cards show the same add-to-shelf control as localized cards. Adding one calls `add-book` with `{ hardcover_id, shelf_id }` and no Simania payload; a localized card still adds by `simania_id` as today. Success, 409 and error handling are the same for both.
   - Opening an English-only card's details still works as today.
3. `public/js/library.js`: a shelved English edition's tile renders like any other (cover or title fallback); English titles in tiles use `dir="auto"`. No other change.
4. `public/css/base.css`: only what these need.

# Tests

- `tests/web/card.test.mjs` (new; follow the DOM setup used in `tests/web/library.test.mjs` or `tests/web/my-rating.test.mjs`): English edition rating label and `dir="auto"`; Simania label for a normal book.
- `tests/web/recs.test.mjs` (keep existing tests): adding an English-only card posts `{ hardcover_id, shelf_id }` without `simania`; a localized card posts `simania_id` as before.

# Acceptance criteria

1. The behavior above; `npm run test:web` passes.
