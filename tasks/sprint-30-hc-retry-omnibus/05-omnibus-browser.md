---
id: S30-T5
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S30-T1
allowed_paths:
  - public/js/simania.js
  - public/js/recs.js
  - tests/web/omnibus.test.mjs
  - tests/web/fixtures/omnibus-replay.jsonl
context:
  - contract
  - architecture.matching
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

The browser links an English-only card to the one Simania volume that holds it, following the contract paragraph "**Omnibus volumes (S30).**". The rule is narrow:
- it runs only after the title match returned no book;
- it needs a subtitle part equal to the hint title;
- it needs a single qualifying result;
- it needs author agreement;
- it always links with `source` `omnibus`, so every case shows in `report:omnibus`.

# Scope

1. `public/js/simania.js`: export `matchOmnibus(hintTitle, results)`, a pure function with no requests.
   - For each result, split `String(result.subtitle ?? "")` on ` | `, trim the parts and drop empty ones.
   - Use the result only when it has at least 2 parts.
   - It counts when some part has `similarity(part, hintTitle) >= 0.9` (the file's existing `similarity`).
   - Return the single counting result, or `null` when none or more than one counts.
   - Do not change `matchHebrewBook` or any other function.
2. `public/js/recs.js`, in `localizeRecommendations`:
   - Only when `hint?.title` is set and `match(...)` returned no book, call `searchBooksFn(hint.title, 6)` once. Use the injectable search dependency, `deps.searchBooks ?? searchBooks`.
   - Then call `matchOmnibus(hint.title, results)`.
   - Accept the returned book only when:
     - `rec.hebrew_author` is set and `similarity(rec.hebrew_author, book.author ?? "") >= 0.6`; or
     - `rec.hebrew_author` is not set and `nameSoundScore(book.author ?? "", englishAuthors) >= 0.8`, where `englishAuthors` is split from `rec.author` as the file already does.
   - Then set `simaniaId` to the book's ID, `source = "omnibus"` and `chosenSimaniaAuthor`. Do not call `match-by-author` for it.
   - A search failure leaves the card unchanged and the author path continues.
   - Everything after it (fetching the payload, `authorGuardRejects`, `link-edition`) is the existing code. Widen the JSDoc type of `source` to include `"omnibus"`.
3. Change nothing else.

# Tests

1. Copy `tasks/sprint-30-hc-retry-omnibus/reference/omnibus-replay.jsonl` unchanged to `tests/web/fixtures/omnibus-replay.jsonl`.
   - It is the S29 replay file with a `subtitle` on every result, taken from live Simania search on 2026-11-21.
   - Its `hint.author` may be null.
2. New `tests/web/omnibus.test.mjs`:
   - **Replay.** For every fixture line, `matchOmnibus(hint.title, results)` is `null`, except `hardcover_id` 427971 (All Systems Red), whose result has `id` 1026206.
   - **Pure cases.**
     - A subtitle with one part (no ` | `) never counts.
     - Two results that both count give `null`.
     - Hint `כשל מערכות` against subtitle `כשל מערכות | התנייה מלאכותית` counts.
     - Hint `התנייה` against the same subtitle does not count.
   - **Localize, All Systems Red.** The card has `english_only: true`, hint `{ title: "כשל מערכות", author: null }`, `hebrew_author: null` and `author: "Martha Wells"`.
     - Stub `match` to return `null`.
     - `searchBooks` returns 1026206 `יומני רובורצח - כרך 1` by `מרתה וולס`, subtitle `כשל מערכות | התנייה מלאכותית`.
     - `fetchPayload` returns its details.
     - `link-edition` is called once, with `simania_id` 1026206 and `source` `omnibus`.
   - **Localize, wrong author.** The same, but the author is `סופר אחר`: no `link-edition` call.
   - **Localize, title match hit.** When `match` returns a book, `searchBooks` is not called for the omnibus rule.

Existing tests pass unchanged, including `tests/web/match-replay.test.mjs`.

# Acceptance criteria

1. The behavior above; `npm run test:web` passes.
