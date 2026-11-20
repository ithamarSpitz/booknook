---
id: S25-T2
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S25-T1
allowed_paths:
  - public/js/simania.js
  - public/js/names.js
  - tests/web/simania.test.mjs
  - tests/web/names.test.mjs
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

Browser matching ignores Hebrew points. Contract: "**Hebrew points (S25).**".

# Scope

1. `public/js/simania.js`:
   - export `stripHebrewPoints(value)`: removes U+0591 to U+05C7 except U+05BE, which becomes a space;
   - `normalize` applies it first, before NFKD.
2. `public/js/names.js`: `nameSoundScore` and the Hebrew skeleton functions apply `stripHebrewPoints` to the Hebrew name first. Import it from `./simania.js` only if that creates no import cycle; otherwise put an identical copy in `names.js` and test both.
3. Nothing else changes. Text without points gives exactly the same results as before.

# Tests

1. `tests/web/simania.test.mjs`:
   - `similarity("אינטרמצו", "אִינְטֶרְמֶצּוֹ") === 1`;
   - `normalize("אִינְטֶרְמֶצּוֹ") === normalize("אינטרמצו")`;
   - `normalize("בית־ספר") === "בית ספר"` (maqaf);
   - `stripHebrewPoints("שָׁלוֹם")` is `"שלום"`;
   - a Latin title with accents normalizes as before, for example `"Café"`.
2. `tests/web/names.test.mjs`:
   - `nameSoundScore("סָאלִי רוּנִי", ["Sally Rooney"])` equals `nameSoundScore("סאלי רוני", ["Sally Rooney"])`, which is at least 0.8;
   - an existing unpointed case keeps its value.
3. Existing tests pass.

# Acceptance criteria

1. The behavior above; `npm run test:web` passes.
