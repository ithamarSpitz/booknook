---
id: S15-T4
stage: 2
model_class: worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on:
  - S15-T3
allowed_paths:
  - public/index.html
  - public/js/removed.js
  - public/css/removed.css
  - public/js/main.js
  - public/js/contract.js
  - tests/web/removed.test.mjs
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

From the menu, the reader opens "ספרים שהסרתי", sees every book they removed from recommendations and why, and can bring one back.

# Scope

Contract: "Removed books page (`#removed`, S15)" and `restore_work` in "`dismissed_works`".

1. `public/js/contract.js`: `ROUTES.REMOVED = "#removed"` (the router accepts it through `ROUTES`).
2. `public/index.html`:
   - a `screen-removed` section (`data-route="removed"`, hidden);
   - a menu link `#removed` "ספרים שהסרתי" with a simple line icon in the style of the others, after "המלצות בשבילי";
   - the `removed.css` stylesheet link.
3. `public/js/main.js`: register the screen and module like `settings`, so the page burger shows on it.
4. New `public/js/removed.js`, with the same module shape as `settings.js` and `invite.js`:
   - Load the caller's `dismissed_works` newest first, with the display data the contract describes (Hebrew edition when one exists, otherwise the work).
   - Render the list with each row's label.
   - "החזר" calls `restore_work` through `client.rpc`, disabling that button while it runs. On success remove the row and toast; on error re-enable it and toast.
   - Loading, empty and error states.
5. New `public/css/removed.css`: rows with a small cover, in the style of `invite.css`'s list. RTL, and it must work at phone width.

# Tests (new `tests/web/removed.test.mjs`)

1. Rows render newest first, with a Hebrew edition title when present, the English work title otherwise, and the right label for each kind.
2. "החזר" calls `restore_work` with `p_work_id`; on success the row leaves the list; on error it stays and a toast shows.
3. The empty state shows "לא הסרת ספרים".
4. `ROUTES.REMOVED` is `#removed`, and the menu has a link to it.
5. Existing tests still pass.

# Acceptance criteria

1. The behavior above; all tests pass.
