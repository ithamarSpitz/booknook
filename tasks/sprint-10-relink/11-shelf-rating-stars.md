---
id: S10-T11
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - public/js/library.js
  - public/css/base.css
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

On the reader's own shelves, a book they rated shows its rating as 5 tiny stars just above the cover. An unrated book shows nothing.

# Scope

Contract: `BookCard` row `rating` (the display sentence).

1. `public/js/library.js` `bookTile(book)`:
   - When `book.rating` is an integer from 1 to 5, add inside `.book`, before the cover:

     `<span class="tile-stars" role="img" aria-label="דירוג: N מתוך 5">`

     with 5 star SVG glyphs. The first `rating` of them have class `on`; the order is RTL, so star 1 is on the right, as in `my-rating.js`.
   - When `book.rating` is null or anything else, render no element at all.
   - Genre shelf tiles (`genreBookTile`) and the `+` tile never get stars.
2. `public/css/base.css`:
   - `.tile-stars` is positioned absolutely at the top of `.book` (which is already `position: relative` in the bookcase theme) and sits inside the row's top padding, directly above the cover. It must not change the tile's or row's size or layout, overlap the upper shelf board, or be covered by the cover.
   - Width equals the cover's width. The 5 stars are spread across it (`justify-content: space-between`), each about 10-11px tall so they fit the gap; check the row's `padding-top` on every breakpoint, including the `max-width: 560px` phone layout, and keep them inside it.
   - Filled stars use the theme's star or accent colour, and empty ones a faint outline or muted fill. They stay still when the cover lifts on hover. They take no pointer events, so tapping the tile still opens the card and dragging still works.
   - Respect the existing light theme. Nothing animates.
3. Rating a book in the card already updates the library state and repaints, so the stars must appear, change or disappear without a reload. If they don't, find out why and fix it in `library.js`.

# Tests (`tests/web/library.test.mjs`)

1. `bookTile` with rating 4: one `.tile-stars` with 5 glyphs, 4 of them `.on`, and the `aria-label` names 4.
2. With rating null: no `.tile-stars`.
3. A genre tile and the `+` tile have none.
4. After `applyOptimisticRating` and a repaint, the tile's stars change.

# Acceptance criteria

1. The behavior above; all tests pass.
2. The UI check (desktop and 390px phone widths) shows the stars fitting between the upper board and the cover, as wide as the cover, with nothing else moved.
