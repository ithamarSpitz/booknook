---
id: S1-T4
stage: 1
model_class: hard_worker
timeout_minutes: 60
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - public/index.html
  - public/css/**
  - public/assets/**
  - public/js/config.js
  - public/js/api.js
  - public/js/data.js
  - public/js/router.js
  - public/js/library.js
  - public/js/card.js
  - public/js/auth.js
  - public/js/settings.js
  - public/js/recs.js
  - public/js/add-book.js
  - public/js/first-run.js
  - public/js/main.js
  - tests/web/**
context:
  - contract
  - architecture.frontend
  - design
environment: null
verification:
  - node --check public/js/main.js
  - node --check public/js/library.js
  - node --check public/js/data.js
  - npm run test:web
---

# Goal

Turn the approved Pine library design into the real app shell, reading and writing the library through Supabase, with stubs for every screen the next lanes build.

# Required context

`docs/architecture/frontend.md` (structure and file ownership), `docs/contract.md` (tables, RPCs, routes). `design/library.html` is the visual source: search it for the CSS, markup and scripts you need (shelf rows, edge arrows, door menu, book card, long-press drag). It embeds images as data URIs; extract them to `public/assets/`.

# Scope

1. `index.html`: page skeleton, a section per route, links to `css/base.css` and to every lane CSS file (create them empty with a header comment), script `type="module"` for `main.js`, a `<link rel="manifest" href="manifest.webmanifest">` (lane D4 creates the file).
2. `config.js` (local Supabase URL and the local anon key from `npx supabase status -o env`, functions base URL), `api.js` (client, session, `callFunction`), `router.js`, `main.js`.
3. `data.js`: load shelves and books (joined with editions) in order; rename shelf; create custom shelf; move book, move shelf, delete shelf, remove book through the RPCs. Accept the client as a parameter for tests.
4. `library.js`: render from data, scroll arrows, long-press drag of books and shelves as in the design, persisted through `data.js` with optimistic update and revert on error. Counts. "+" tile calls `addBook.open(shelfId)` from the D3 stub. "+ מדף חדש", rename, delete for custom shelves.
5. `card.js`: the book card from `BookCard`, with "move to shelf" select and "remove from library". No external links.
6. Stubs exporting the agreed function names, with no behavior: `auth.js` (`mount`, `requireSession` returning the current session or redirecting to `#login`), `settings.js`, `recs.js`, `add-book.js` (`mount`, `open(shelfId)`), `first-run.js` (`mount`, `shouldShow(shelves)`).
7. Door menu items: הספרייה שלי, המלצות בשבילי, חיפוש ספרים, הגדרות. Library name from `profiles.display_name`.
8. `tests/web`: `node --test` tests for pure helpers (ordering, optimistic move and revert, row mapping) and for `data.js` with a fake client.

# Out of scope

Real login UI, settings UI, recommendations UI, search UI, first-run, manifest. Function and database code.

# Invariants

- Look and interaction match the design. Do not redesign.
- No framework, no bundler. supabase-js from the pinned jsDelivr ESM URL in `docs/architecture/overview.md`.
- No service-role key in `public/`.

# Acceptance criteria

1. Opening `index.html` through `npm run web:serve` with a signed-in session renders the user's shelves from the database.
2. Drag, rename, new shelf, delete shelf, move and remove from the card survive a reload.
3. Tests pass.
