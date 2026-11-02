---
id: S5-T1
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - public/js/app-open-refresh.js
  - public/js/main.js
  - tests/web/app-open-refresh.test.mjs
context:
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

Opening the app regenerates recommendations in the background, so server-side fixes (for example the recommendations function linking a couple of unlinked shelved books per run) reach readers without waiting for a shelf change.

# Context

Today the only trigger is the `SHELVES_CHANGED` event in `public/js/main.js`: `document.addEventListener(SHELVES_CHANGED, () => ctx.recsRefresh.request())`. `ctx.recsRefresh` comes from `createRecsRefresher` (`public/js/recs-refresh.js`); `request()` is debounced and safe to call while a run is in progress. Do not change `recs-refresh.js`.

# Scope

1. New module `public/js/app-open-refresh.js` exporting `createOpenRefresh({ request, now = () => Date.now(), minHiddenMs = 30 * 60 * 1000 })` that returns:
   - `signedIn()`: the first call per page load calls `request()` once; later calls do nothing.
   - `visibility(visible: boolean)`: when the page becomes hidden, remember the time. When it becomes visible again, call `request()` only if `signedIn()` has been called and the page was hidden for at least `minHiddenMs`. Repeated "visible" without a "hidden" in between does nothing.
   Pure logic, no DOM access, so `node --test` can test it.
2. `public/js/main.js`: create one instance with `request: () => ctx.recsRefresh.request()`. Call `signedIn()` in `onRoute` right after `auth.requireSession(api)` returns a session (every route, so opening the app on any screen counts). Add one `document.addEventListener("visibilitychange", ...)` that calls `visibility(document.visibilityState === "visible")`. No other change in `main.js`.

No UI change, no new network call other than the existing refresher's.

# Tests

New file `tests/web/app-open-refresh.test.mjs`:

1. `signedIn()` twice → `request` called exactly once.
2. Hidden 31 minutes then visible (after `signedIn()`) → one more `request`; hidden 5 minutes then visible → none.
3. Visible after a long hide but before `signedIn()` → no `request`.
4. Two "visible" events after one long hide → only one `request`.

# Acceptance criteria

1. Opening the app while signed in triggers exactly one background recommendations refresh per page load; returning to the app after 30+ minutes away triggers one more.
2. `npm run test:web` passes.
