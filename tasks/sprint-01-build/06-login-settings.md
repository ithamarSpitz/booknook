---
id: S1-T6
stage: 2
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S1-T4
allowed_paths:
  - public/js/auth.js
  - public/js/settings.js
  - public/css/auth.css
  - public/css/settings.css
  - tests/web/auth*.test.mjs
  - tests/web/settings*.test.mjs
context:
  - contract
  - architecture.frontend
environment: null
verification:
  - node --check public/js/auth.js
  - node --check public/js/settings.js
  - npm run test:web
---

# Goal

Login, session guard, logout and the settings screen.

# Required context

`docs/architecture/frontend.md`, `docs/contract.md`. Existing `public/js/api.js`, `router.js`, `main.js`, `css/base.css` and the stub `auth.js` / `settings.js` from the shell.

# Scope

1. `auth.js`: `#login` screen (email, password, submit, Hebrew errors for wrong password and network failure, "שכחתי סיסמה" sending a reset email), `requireSession` used by the router, redirect back to `#library` after login. No sign-up form (invite only).
2. `settings.js`: `#settings` screen with display name (updates `profiles.display_name`, the library title updates) and "התנתק".
3. Styles in the pine design language, in your two CSS files only.
4. Tests for pure helpers (error message mapping, form validation).

# Out of scope

Any file not listed. If the shell's stub signatures do not fit, stop and report.

# Acceptance criteria

1. A signed-out visitor always lands on `#login`.
2. Logout returns to `#login` and clears the session.
3. Tests pass.
