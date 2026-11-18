---
id: S15-T3
stage: 1
model_class: worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - public/index.html
  - public/js/recs.js
  - public/js/library.js
  - public/js/contract.js
  - public/css/base.css
  - tests/web/recs.test.mjs
  - tests/web/library.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
  - npm run check:contract
---

# Goal

A recommended book can be removed with one of two buttons, "הסר" or "לא הסגנון שלי", both on the Recommendations page and on the library's genre shelves.

# Scope

Contract: "Removing a recommended book (browser, S15)" and the `dismiss_work` RPC in "`dismissed_works`".

1. `public/js/contract.js`: add `RPCS.DISMISS_WORK` (`dismiss_work`, params `p_work_id`, `p_kind`) and `RPCS.RESTORE_WORK` (`restore_work`, params `p_work_id`).
2. `public/index.html`: in the book card, add a second button `.bk-not-my-type`, hidden by default, next to `.bk-remove`.
3. `public/css/base.css`: style `.bk-not-my-type` like `.bk-remove`, plus `.bk-not-my-type[hidden]{display:none}`.
4. `public/js/recs.js`:
   - The recommendation card chrome shows `.bk-remove` as "הסר" and `.bk-not-my-type` as "לא הסגנון שלי".
   - Each button calls `dismiss_work` through `client.rpc` with its kind, replacing the direct `recommendations` update.
   - Disable both buttons while the call runs; handle success and failure as the contract says (toasts, close, `onDismissed`).
   - The library card chrome (`LIBRARY_REMOVE_LABEL`) hides `.bk-not-my-type` again.
   - Remove the `allowDismiss` option only if nothing uses it any more.
5. `public/js/library.js`: the genre shelf card allows both buttons, and `onDismissed` drops the tile from the genre shelf at once (like `onAdded` does with `removeGenreBook`).

# Tests

1. Recs card: both buttons are shown with their labels; each calls `dismiss_work` with the right `p_kind` and `p_work_id`; on success the card closes and `onDismissed` gets the work. On error both buttons re-enable and a toast shows.
2. English-only recs card: both buttons are shown.
3. Genre shelf card: both buttons are shown; a success removes the tile from its shelf.
4. A library book's card shows only "הסר מהספרייה" (`.bk-not-my-type` hidden), including after a recs card was opened first.
5. Existing tests still pass (update the ones that expected "לא מעניין אותי" or the direct update).

# Acceptance criteria

1. The behavior above; all tests pass.
