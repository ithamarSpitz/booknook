---
id: S29-T2
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S29-T1
allowed_paths:
  - public/js/simania.js
  - tests/web/simania.test.mjs
  - tests/web/match-replay.test.mjs
  - tests/web/fixtures/match-replay.jsonl
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

`matchHebrewBook` in `public/js/simania.js` follows the contract paragraph "**Simania match rules (S29).**": word subset, the tie-break order, and one-word hints.

# Scope

- Change only `matchHebrewBook`, plus small private helpers in the same file if needed.
- Keep its signature and return value.
- Reuse the file's existing `similarity`, normalization and point-stripping helpers.
- Do not touch `recs.js`, `link-edition` or anything else.

# Tests

1. Copy `tasks/sprint-29-match-rules/reference/match-replay.jsonl` unchanged to `tests/web/fixtures/match-replay.jsonl`. Each line has `hardcover_id`, `hint {title, author}`, `results [{id, title, author}]`, `linked` and `current`.
2. `tests/web/match-replay.test.mjs`: for each line, call `matchHebrewBook(hint.title, hint.author ?? "", fakeFetch)`, where the fake fetch answers every search with that line's `results` in the existing Simania response shape used in `tests/web/simania.test.mjs`. Then assert:
   - for each of the 213 lines whose `current` is in `linked`, the pick's ID equals `current`;
   - for each line with empty `linked`, the pick equals `current`, except `hardcover_id` 175780, which picks 982600;
   - print nothing else.

   One-word hint lines get the same `results` from both searches, and the duplicates are dropped.
3. In `tests/web/simania.test.mjs`:
   - The one-word hint `זר` by `סטיבן קינג`: the first search returns six other books, the title search returns `{ id: 994441, title: "זר", author: "סטיבן קינג" }`. The match is 994441, and exactly 2 searches were made.
   - A two-word hint makes the title-alone search only when the first search is empty, as before.
   - The word-subset boost is not applied when the author Dice is below `0.6`. Example: hint `גאווה ודעה קדומה` by `ג'יין אוסטן` does not boost `כסף, גאווה ודעה קדומה` by another author over `גאווה ודעה קדומה [מהדורת 2009]` by `ג'יין אוסטן`.
   - A label tie-break case: two results with an equal old score, where the one whose label-stripped title equals the hint wins.

Existing tests pass.

# Acceptance criteria

1. The behavior above; `npm run test:web` passes.
