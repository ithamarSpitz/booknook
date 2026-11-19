---
id: S21-T2
stage: 2
model_class: hard_worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on:
  - S21-T1
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

`nameSoundScore` recognizes short and common name spellings, so "ג'ו היל" matches "Joe Hill" (it scores 0.00 today), while names of different people still score low.

# Scope

Contract: "Name sound fixes (S21)", which lists every same-person pair (≥ 0.6) and different-person pair (≤ 0.3).

1. Find why the listed same-person pairs score low. A likely cause: Hebrew `ו` and `י` are kept as consonants where they are vowels (ג'ו → "jv"), and digraphs and geresh are handled differently on the two sides. Fix the skeleton or scoring in `public/js/names.js`.
2. Make the identical change in `supabase/functions/_shared/names.ts`, which is the same algorithm; keep them in parity.
3. Keep the function signatures. Only change what is needed.

# Tests

1. In `tests/functions/name-sound.test.ts`, add every contract pair with its bound. All existing `SAME_PERSON` and other cases keep their expected side. If an existing skeleton test's exact string changes because of the fix, update only that expectation, and explain why in your final message.
2. Parity: the browser and server functions give the same score for every pair. Add this to the existing parity test if there is one; otherwise create `tests/web/names.test.mjs` that imports `public/js/names.js` and checks the same pairs.

# Acceptance criteria

1. Every contract pair is within its bound in both copies; `check:functions`, `test:functions` and `test:web` pass.
