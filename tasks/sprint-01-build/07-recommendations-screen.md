---
id: S1-T7
stage: 2
model_class: hard_worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on:
  - S1-T3
  - S1-T4
allowed_paths:
  - public/js/recs.js
  - public/css/recs.css
  - tests/web/recs*.test.mjs
context:
  - contract
  - architecture.frontend
  - design
environment: null
verification:
  - node --check public/js/recs.js
  - npm run test:web
---

# Goal

The "המלצות בשבילי" screen.

# Required context

`docs/architecture/frontend.md` (Recommendations), `docs/contract.md` (`RecommendationCard`, `recommendations` function, the `recommendations` table). Existing shell modules, `card.js`, `css/base.css`.

# Scope

1. `#recs`: show stored recommendations from the table at once, with a "רענן" action that calls the `recommendations` function. A clear loading state for a call that can take tens of seconds.
2. Each item: cover in the same size as shelf covers, title, and one reason line: "בגלל שקראת X" / "בגלל שקראת X ו-Y" from `because`, or the shared tags. English-only items (`simania_id` null) show the Hardcover title and cover, a short note that there is no Hebrew edition, and only "לא מעניין אותי" (no add-to-shelf).
3. Tap opens the shared book card (`card.js`) with "הוסף למדף" (shelf select, then the `add-book` function) and "לא מעניין אותי" (sets `dismissed`, removes it from view).
4. Empty state when the user has no read or reading books: one line pointing them to the library.
5. Tests for the reason-line builder and list state helpers.

# Out of scope

Any file not listed. If `card.js` needs a hook it does not expose, stop and report.

# Acceptance criteria

1. Never shows a book that is on one of the user's shelves (the function guarantees it; the screen must not cache stale items after "add to shelf").
2. Tests pass.
