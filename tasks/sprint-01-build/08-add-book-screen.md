---
id: S1-T8
stage: 2
model_class: hard_worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on:
  - S1-T2
  - S1-T4
allowed_paths:
  - public/js/add-book.js
  - public/css/add-book.css
  - tests/web/add-book*.test.mjs
context:
  - contract
  - architecture.frontend
  - design
environment: null
verification:
  - node --check public/js/add-book.js
  - npm run test:web
---

# Goal

The add-book flow from the "+" tile and the "חיפוש ספרים" screen.

# Required context

`docs/architecture/frontend.md` (Add book), `docs/contract.md` (`search-books`, `add-book`). Existing `add-book.js` stub, `library.js` (how it calls `open(shelfId)` and how to refresh a shelf), `css/base.css`, the picker in `design/library.html`.

# Scope

1. `open(shelfId)`: the add box from the design, preset to that shelf. Results appear while typing (300 ms debounce, ignore stale responses), each with cover, title, author, year. No search button. Loading, "לא נמצאו ספרים", and error states.
2. Tap a result: the book appears on the shelf at once in a pending state, `add-book` is called, the card data fills in; on 409 show "הספר כבר בספרייה שלך"; on error remove it and show a message.
3. `#search` route (`mount`): the same search full screen, and choosing a result asks which shelf.
4. Tests for debounce, stale-response handling and result mapping.

# Out of scope

Any file not listed. If `library.js` lacks a hook you need, stop and report.

# Acceptance criteria

1. Typing two letters shows results without pressing anything.
2. Adding a book survives a reload.
3. Tests pass.
