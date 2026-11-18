---
id: S16-T1
stage: 1
model_class: worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - public/index.html
  - public/css/base.css
  - public/css/recs.css
  - public/js/recs.js
  - public/js/card.js
  - tests/web/card.test.mjs
  - tests/web/recs.test.mjs
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

On every book card, the shelf selector and the remove buttons sit right below the ratings, and the long description and details come after them.

# Scope

Contract: "Book card layout (S16)". Follow it exactly; change no behavior beyond the order, the button row, the button size and the library remove label.

1. `public/index.html`, the `#bk` card body, in this order:
   - `.bk-shelf`, `.bk-title`, `.bk-author`, `.bk-rating`, `.bk-my-rating`;
   - `.bk-actions`, holding `.bk-move` and then a new `.bk-buttons` wrapper around `.bk-remove` and `.bk-not-my-type`;
   - the "על הספר" heading and `.bk-desc`;
   - `dl.bk-meta`.

   The library remove text becomes "הסר".
2. `public/css/base.css`:
   - `.bk-actions` keeps its column layout, with about 14px top margin and 18px bottom margin; the select is full width up to 320px.
   - `.bk-buttons` is a row with `flex-wrap: wrap` and an 8px gap.
   - `.bk-remove` and `.bk-not-my-type` become secondary: about 14px text and 8px by 14px padding, same colors.

   It must work at phone width, with no horizontal scroll. Touch `public/css/recs.css` only if it overrides these.
3. `public/js/recs.js`:
   - `LIBRARY_REMOVE_LABEL = "הסר"`.
   - The reason line is inserted at the top of `.bk-actions`, not inside `.bk-buttons`.
   - The English-only note goes directly before `.bk-buttons`.

   Find both by class, not through `removeBtn.parentElement`. Restoring the library card chrome removes them, as today.
4. `public/js/card.js`: only if it depends on the old order or the old label.

# Tests

1. In the card markup, `.bk-actions` comes after `.bk-my-rating` and before `.bk-desc`, and `.bk-meta` comes after `.bk-desc`.
2. A recommendation card: the reason line is the first child of `.bk-actions`, and both buttons are inside `.bk-buttons`. An English-only card: the note sits directly before `.bk-buttons`.
3. A library card opened after a recommendation card shows no reason line or note, only "הסר" (and `.bk-not-my-type` is hidden).
4. Existing tests still pass (update those that expected "הסר מהספרייה" or the old positions).

# Acceptance criteria

1. The behavior above; all tests pass.
