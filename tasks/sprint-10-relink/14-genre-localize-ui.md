---
id: S10-T14
stage: 4
model_class: hard_worker
timeout_minutes: 45
review: true
allow_protected: false
depends_on:
  - S10-T10
  - S10-T11
  - S10-T12
  - S10-T13
allowed_paths:
  - public/js/library.js
  - public/js/contract.js
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

English-only books on the genre shelves turn into their Hebrew editions when Simania has one, as recommendation cards already do.

# Bug (production, 2026-11-05)

Of one reader's 60 genre books, 46 show in English. The S8 plan made no Simania or bridge calls for genre shelves. Yet the recommendations page's own localization finds Hebrew editions for these books:

| English | Hebrew (Simania id) |
|---|---|
| Eleanor Oliphant Is Completely Fine | אלינור אוליפנט ממש בסדר (987746) |
| Lessons in Chemistry | שיעורים בכימיה (1005415) |
| The Ballad of Songbirds and Snakes | בלדה לנחשים וציפורי שיר (998308) |

# Scope

Contract: "Genre recommendation shelves", **Localizing them (browser)**, and `genre-hint`.

1. `public/js/contract.js`: `FUNCTIONS.GENRE_HINT = "genre-hint"`.
2. `public/js/library.js`, after the genre shelves render on mount:
   - Pick the English-only genre books in shelf order, then position. Skip those tried on this device in the last 14 days: `localStorage` key `booknook.genreLocalizeTried`, a JSON map of `work_id` to ISO time. Wrap every read and write in try/catch; a failure means skip nothing and record nothing. Take at most 12.
   - Run 2 at a time. For each book, mark it tried, call `genre-hint`, and when a hint or a Hebrew author comes back, run **`localizeRecommendations`** from `public/js/recs.js` on that one book. Reuse it as it is; do not copy it. Pass `{ work_id, title, english_only: true, hebrew_hint, hebrew_author }`, the same `callFunction`, and an `isCurrent` that turns false on unmount or when a new genre session starts.
   - On `onLinked`, update that book in the genre session: `simania_id`, `title`, `author`, `cover_url`, `english_only: false`. Then repaint only that tile in place. The row keeps its scroll position and nothing else re-renders.
   - Opening the tile afterwards loads the Simania edition, as a localized book does. Errors are silent (a `console.warn`, as in `localizeRecommendations`).
   - No change in `recs.js` should be needed. If one is, stop and report.

# Tests (`tests/web/library.test.mjs`, fakes only)

1. With 14 English-only genre books, 12 are attempted, in shelf and position order, at most 2 at a time.
2. A work tried within 14 days is skipped. A `localStorage` that throws still attempts the books.
3. A linked book's tile shows the Hebrew title and cover, its `data-work-id` is unchanged, and other tiles are untouched.
4. Unmount stops further attempts.
5. A `genre-hint` that rejects is silent, and the next book is still tried.

# Acceptance criteria

1. The behavior above; all tests pass.
2. The UI check shows a genre shelf whose English tiles change to Hebrew in place, with no layout jump.
