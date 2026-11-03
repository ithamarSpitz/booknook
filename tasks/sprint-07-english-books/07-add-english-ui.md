---
id: S7-T7
stage: 3
model_class: worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on:
  - S7-T4
  - S7-T5
allowed_paths:
  - public/js/add-book.js
  - public/js/simania.js
  - public/js/contract.js
  - public/css/base.css
  - tests/web/add-book.test.mjs
  - tests/web/simania.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

In the existing add-book search box, typing in English finds English books on Hardcover, and picking one shelves it as an English edition. Hebrew search is unchanged.

# Scope

1. `public/js/contract.js`: add `SEARCH_ENGLISH: "search-english"` to `FUNCTIONS`; add `english_edition` to the BookCard JSDoc.
2. `public/js/add-book.js`:
   - Export `isEnglishQuery(text)`: true when the trimmed text contains a Latin letter `[A-Za-z]` and no Hebrew letter `[֐-׿]`.
   - When the query is English, call the `search-english` function (same session/auth headers as `add-book`) instead of Simania, and show its results in the same result list (cover, title, author, year), marked with a small "אנגלית" label. Same debounce, empty and error states as the Simania search. Hebrew or mixed queries use Simania exactly as today.
   - Picking an English result calls `add-book` with `{ hardcover_id, shelf_id }` (no `simania` payload, no Simania calls) and then behaves exactly like a Simania add (pending tile, 409 duplicate message, errors).
3. `public/js/simania.js`: `fetchSimaniaPayload` (and any other Simania call taking an edition ID) returns null without a network call for a negative ID.
4. `public/css/base.css`: only what the "אנגלית" label needs. English titles and authors in results use `dir="auto"` so they read left-to-right.

# Tests

- `tests/web/add-book.test.mjs`: `isEnglishQuery` cases (`"Spin"` true, `"סחרור"` false, `"Spin סחרור"` false, `"1984"` false); an English query calls `search-english` and not Simania; picking a result posts `{ hardcover_id, shelf_id }` with no `simania` field. Use the module's existing test seams; add small injectable seams if needed without changing behavior.
- `tests/web/simania.test.mjs`: `fetchSimaniaPayload(-383752)` makes no fetch.

# Acceptance criteria

1. The behavior above; `npm run test:web` passes.

# Previous attempt (start here)

A previous attempt implemented this task (verification passed) and stopped only because the agent quota ran out during review. Apply `tasks/sprint-07-english-books/draft/S7-T7-changes.diff.txt` (for example `git apply --ignore-whitespace`), review it carefully against this brief and the contract, fix anything missing or wrong, then run the verification commands. Do not edit the draft files.
