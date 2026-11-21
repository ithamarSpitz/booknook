---
id: S31-T6
stage: 2
model_class: worker
timeout_minutes: 20
review: true
allow_protected: false
depends_on:
  - S31-T1
allowed_paths:
  - public/js/data.js
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

A genre shelf never shows a book whose work is already on one of the reader's shelves, even when the stored genre rows are older than a new link. Contract: "**Genre shelves skip shelved works (S31).**".

Live case, 2026-11-21:
- A reader's shelved edition 978636 was linked to work The Glass Castle after her genre shelves had been stored.
- Her genre shelf then showed edition 85173 of the same work, while the book was on her "read" shelf.
- The next recommendations run removes such rows, but until then the shelf shows the duplicate.

# Scope

- In `loadGenreShelves` (`public/js/data.js`), make one extra read: `shelf_books` with `editions(work_id)`, through the caller's RLS.
- Drop genre rows whose `work_id` is one of those non-null work IDs before `mapGenreRows`.
- When that read fails, keep all rows, since the genre shelves remain usable.
- Change nothing else.

# Tests

In `tests/web/data.test.mjs`, with the file's existing fake client style:
1. Genre rows for works `w1` and `w2`, with a shelved edition linked to `w2`: only `w1` is returned.
2. A shelved edition with `work_id` null removes nothing.
3. A failing shelf read keeps both rows.

Existing tests pass.

# Acceptance criteria

1. The behavior above; `npm run test:web` passes.
