---
id: S8-T5
stage: 3
model_class: worker
timeout_minutes: 45
review: true
allow_protected: false
depends_on:
  - S8-T4
allowed_paths:
  - public/js/library.js
  - public/js/recs.js
  - public/css/base.css
  - tests/web/library.test.mjs
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

The library screen shows the genre recommendation shelves below the reader's own shelves, loaded once and never changing while the screen is open.

# Scope

Contract: "Genre recommendation shelves" ("Reading them (browser)").

1. `public/js/library.js`:
   - On mount, after the library itself, call `loadGenreShelves(client)` once (from `data.js`). Do not call it again while mounted: not on recommendation refresh events, shelf changes, visibility changes or library redraws. A failure or empty result shows nothing.
   - Render each genre shelf after the reader's own shelves and after the "+ מדף חדש" control, using the same wooden shelf look (`.shelf` structure) so it feels part of the bookcase, with the class `genre-shelf`. Label: the Hebrew genre name as the title and `מומלצים בשבילך` instead of the book count. No edit/delete buttons, no "+" tile, not draggable, not a drop target, not included in shelf reordering or the reader's shelf list anywhere (move menus, add-book shelf choices).
   - Book tiles look like the reader's tiles (cover, or title fallback; `dir="auto"` titles). No spinner and no loading placeholder for genre shelves; they appear when loaded, before which nothing is shown.
   - When the library redraws (for example after the reader moves a book), the genre shelves are redrawn from the data loaded at mount, not reloaded. A book the reader adds from a genre shelf disappears from that shelf immediately (local removal), since it is now on their shelves.
   - Tapping a genre book opens the book card through the same path the recommendations screen uses, with the add-to-shelf control and without the dismiss button.
2. `public/js/recs.js`: export the card-opening path used by the recommendations screen in a reusable form (for example `openRecommendationCard(item, deps, { allowDismiss })`), where `item` has `work_id`, `hardcover_id`, `simania_id`, `title`, `author`, `cover_url`, `english_only`. Adding uses `add-book` with `simania_id`, or `hardcover_id` when English-only (same as recommendation cards). The recommendations screen keeps working exactly as today.
3. `public/css/base.css`: only what `.genre-shelf` needs, consistent with the carved shelf labels.

# Tests

- `tests/web/library.test.mjs` (keep existing ones): genre shelves render after the reader's shelves with the genre name and `מומלצים בשבילך`; no "+" tile or edit buttons; they are not in the reader's shelf list; `loadGenreShelves` is called exactly once per mount even after redraws and refresh events; an added book is removed locally.
- `tests/web/recs.test.mjs`: the exported card path with `allowDismiss: false` hides dismiss; English-only adds by `hardcover_id`.

# Acceptance criteria

1. The behavior above; `npm run test:web` passes.
