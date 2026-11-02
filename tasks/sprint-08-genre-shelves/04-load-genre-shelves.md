---
id: S8-T4
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S8-T1
allowed_paths:
  - public/js/data.js
  - public/js/contract.js
  - tests/web/data.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

The browser can load the caller's genre recommendation shelves in one query.

# Scope

Contract: `GenreShelf` and `GenreBook`.

1. `public/js/data.js`:
   - Export pure `mapGenreRows(rows)` returning `GenreShelf[]`: groups rows by `genre`, orders shelves by `shelf_position` and books by `position`, and maps each book per the contract (edition fields first, else work fields; `english_only` when `simania_id` is null).
   - Export `loadGenreShelves(client)`: one select on `genre_recommendations` with embedded `works(hardcover_id, original_title, original_authors, hardcover_cover_url)` and `editions(title, author, cover_url)`, ordered by `shelf_position`, `position`; returns `mapGenreRows(data)`; on error returns `[]` (genre shelves are optional and never break the library).
2. `public/js/contract.js`: JSDoc typedefs for `GenreShelf` and `GenreBook`.

# Tests (`tests/web/data.test.mjs`, keep existing ones)

1. `mapGenreRows`: two genres out of order are sorted; books sorted; edition fields win over work fields; English-only fallback (authors joined, work cover); empty input → `[]`.
2. `loadGenreShelves` with a fake client: builds the expected select; an error → `[]`.

# Acceptance criteria

1. The behavior above; `npm run test:web` passes.
