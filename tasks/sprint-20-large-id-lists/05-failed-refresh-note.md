---
id: S20-T5
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S20-T1
allowed_paths:
  - public/js/recs-refresh.js
  - public/js/recs.js
  - public/js/genre-settings.js
  - public/css/recs.css
  - public/css/genre-settings.css
  - tests/web/recs-refresh.test.mjs
  - tests/web/recs.test.mjs
  - tests/web/genre-settings.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

A reader can see when their recommendations failed to update, instead of the failure only going to the console. One reader's updates failed silently for 9 days.

# Scope

Contract: "Failed regeneration (browser, S20)".

1. `public/js/recs-refresh.js`:
   - keep a `failed` flag: true after a run throws, from the `recommendations` call or from localization; false after a run completes;
   - expose `failed()`;
   - notify subscribers when it changes, as for `busy`;
   - keep the `console.warn`.
2. `public/js/recs.js` (the `#recs` screen) and `public/js/genre-settings.js` (the `#genres` screen): while `ctx.recsRefresh.failed()` is true and `busy()` is false, show the status line "העדכון האחרון של ההמלצות נכשל. ננסה שוב בשינוי הבא." at the top, with `role="status"`. Hide it when that stops being true, using the existing subscription. Guard for a context without `recsRefresh`, as the screens already do.
3. CSS: a small muted status line in each screen's own stylesheet. It must work in RTL and at phone width.

# Tests

1. `recs-refresh.test.mjs`: a run whose call throws sets `failed()` true and notifies; the next successful run sets it false; a localization error also sets it.
2. `recs.test.mjs` and `genre-settings.test.mjs`: the line shows when failed and not busy, hides while busy, and hides after a success.
3. Existing tests pass.

# Acceptance criteria

1. The behavior above; `test:web` passes.
