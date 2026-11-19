---
id: S22-T2
stage: 2
model_class: hard_worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on:
  - S22-T1
allowed_paths:
  - public/js/names.js
  - supabase/functions/_shared/names.ts
  - tests/functions/name-sound.test.ts
  - tests/web/names.test.mjs
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - npm run test:web
---

# Goal

`nameSoundScore` handles initials (E.B. White = אלוין ברוקס וייט) and a silent "gh" (Hugh Howey = יו האווי), and it scores Jacqueline Wilson against David Sierra Listón low.

# Scope

Contract: "Guard precision (S22)", the `nameSoundScore` pairs.

1. Change the scoring in `public/js/names.js` and make the identical change in `supabase/functions/_shared/names.ts`; the two copies stay in parity.
2. Keep the signatures, and change only what is needed. Every S21 pair and every existing test case must keep its side.

# Tests

1. Add the S22 pairs to `tests/functions/name-sound.test.ts`, with their bounds.
2. Add the same pairs to the browser parity test in `tests/web/names.test.mjs`.

# Acceptance criteria

1. Every S21 and S22 pair is within its bound in both copies; `check:functions`, `test:functions` and `test:web` pass.
