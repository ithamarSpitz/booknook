---
id: S16-T2
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S16-T1
allowed_paths:
  - public/js/events.js
  - public/js/main.js
  - public/js/recs.js
  - public/js/removed.js
  - tests/web/recs.test.mjs
  - tests/web/removed.test.mjs
  - tests/web/recs-refresh.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

Pressing "הסר", "לא הסגנון שלי" or "החזר" starts a background recalculation of recommendations, so the change shows up without waiting for a shelf change or the next day.

# Scope

Contract: "Refresh after removing or restoring (S16)".

1. `public/js/events.js`: add `RECS_INPUTS_CHANGED` and `notifyRecsInputsChanged()`, in the style of the existing event.
2. `public/js/main.js`: on `RECS_INPUTS_CHANGED`, call `ctx.recsRefresh.request()` (next to the `SHELVES_CHANGED` listener).
3. `public/js/recs.js`: after a successful `dismiss_work` call, `notifyRecsInputsChanged()`, both for a card opened from the Recommendations page and for one opened from a library genre (recommendation) shelf. Not on failure.
4. `public/js/removed.js`: after a successful `restore_work` call, `notifyRecsInputsChanged()`. Not on failure.

Do not fire `SHELVES_CHANGED` for these actions.

# Tests

1. A successful dismissal of each kind fires `RECS_INPUTS_CHANGED` once, from the Recommendations page and from a genre shelf card; a failed one fires nothing.
2. A successful restore fires it once; a failed one fires nothing.
3. Neither fires `SHELVES_CHANGED`.
4. Existing tests still pass.

# Acceptance criteria

1. The behavior above; all tests pass.
