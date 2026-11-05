---
id: S10-T10
stage: 3
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S10-T9
allowed_paths:
  - public/js/data.js
  - public/js/contract.js
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

Opening a book on a genre shelf shows why it is recommended ("דומה ל־…"), as the recommendations page does.

# Scope

Contract: `GenreShelf` and `GenreBook` (`because`, `because_titles`), and "Reading them (browser)" (last sentence).

1. `public/js/data.js`:
   - `loadGenreShelves` also selects `because`.
   - Then, in one extra query, it loads the edition titles for all `because` IDs. Use the same lookup the recommendations page uses (see `public/js/recs.js`, the query on `editions` by `simania_id` for `because` IDs).
   - `mapGenreRows` sets `because` (numbers) and `because_titles` (titles in `because` order, unknown IDs skipped).
   - The title query failing gives empty `because_titles`; the shelves still load.
2. `public/js/contract.js`: the `GenreBook` typedef gains `because` and `because_titles`.
3. No change to `recs.js`, `card.js` or `library.js` is expected: the genre card already opens through `openRecommendationCard`, which shows `buildReasonLine(rec.because_titles, rec.shared_tags)` (`shared_tags` is undefined for genre books, and is treated as empty). If that is not true, stop and report it.

# Tests

1. `tests/web/data.test.mjs`:
   - `mapGenreRows` maps `because` and `because_titles` in order and skips unknown IDs.
   - `loadGenreShelves` with a fake client returns titles.
   - A failing title query still returns the shelves.
2. `tests/web/library.test.mjs`: opening a genre book whose `because_titles` is `["החברה הגאונה"]` shows a `.bk-rec-reason` containing `החברה הגאונה`. Closing the card removes it.

# Acceptance criteria

1. The behavior above; all tests pass. In the real app, opening a genre book shows the reason line.
