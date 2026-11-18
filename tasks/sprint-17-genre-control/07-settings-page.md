---
id: S17-T7
stage: 4
model_class: worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on:
  - S17-T3
  - S17-T6
allowed_paths:
  - public/index.html
  - public/js/genre-settings.js
  - public/css/genre-settings.css
  - public/js/main.js
  - public/js/contract.js
  - tests/web/genre-settings.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
  - npm run check:contract
---

# Goal

From the menu, the reader opens "הגדרות מדפי המלצות". There they choose how many genre shelves to see (1-20) and set each genre to automatic, always show, or never show.

# Scope

Contract: "Recommendation shelf settings page (#genres, S17)", `set_genre_preference`, `set_genre_shelf_count`, `reader_genres`, `genre_preferences`.

1. `public/js/contract.js`: `ROUTES.GENRES = "#genres"`.
2. `public/index.html`:
   - a `screen-genres` section (`data-route="genres"`, hidden);
   - a menu link `#genres` "הגדרות מדפי המלצות" with a simple line icon in the style of the others, after "ספרים שהסרתי";
   - the stylesheet link.
3. `public/js/main.js`: register the screen and module like `removed`.
4. New `public/js/genre-settings.js`, the same module shape as `removed.js`:
   - The shelf count select.
   - The genre list (union, order, count line, "מוצג עכשיו" tag, three-option control).
   - The pin limit rule and its note.
   - The toasts, rollback on failure, `notifyRecsInputsChanged()` after each success, and the loading, empty and error states.
5. New `public/css/genre-settings.css`: RTL rows; the three options as a compact segmented control. It must work at phone width with no horizontal scroll.

# Tests (new `tests/web/genre-settings.test.mjs`)

1. Rows follow the union order, with the count line and the "מוצג עכשיו" tag; a preference-only genre shows after them.
2. Choosing each option calls `set_genre_preference` with the right state; a success fires `RECS_INPUTS_CHANGED` once; a failure restores the previous option and shows a toast.
3. The select calls `set_genre_shelf_count`.
4. At N − 1 pins, "תמיד להציג" is disabled on unpinned rows, and the note shows.
5. The empty state.
6. `ROUTES.GENRES` is `#genres`, and the menu links to it after "ספרים שהסרתי".
7. Existing tests pass.

# Acceptance criteria

1. The behavior above; `test:web` and `check:contract` pass.
