---
id: S25-T4
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S25-T1
allowed_paths:
  - public/js/recs.js
  - tests/web/recs.test.mjs
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

A title-hint match is verified when the Simania author sounds like the card's English author. Contract: "**Title-match verification.**", the S25 third rule.

# Scope

`public/js/recs.js`, `verifyTitleMatch(rec, book, deps)`, after the existing `hebrew_author` Dice check and before the `match-by-author` call:

- `englishAuthors` is `rec.author` split on `,`, trimmed, with empty parts dropped.
- If `englishAuthors` is not empty and `nameSoundScore(book.author ?? "", englishAuthors) >= 0.8` (from `./names.js`), return `{ simania_id, resolve_status }`. `resolve_status` is `"nli"` when `rec.hebrew_hint?.source === "nli"`, else `"wikidata"`. Make no `match-by-author` call.
- Otherwise, behave exactly as before.

# Tests

In `tests/web/recs.test.mjs`, `describe("verifyTitleMatch")`, with a `callFunction` stub that records calls:

1. **Don Quixote:** rec `{ work_id: "w", author: "Miguel de Cervantes Saavedra, Roberto González Echevarría", hebrew_author: null, hebrew_hint: { source: "wikidata", title: "דון קישוט", author: "מיגל דה סרוואנטס" } }`, book `{ simania_id: 64376, title: "דון קישוט איש למנשא", author: "מיגל דה סרוואנטס" }`. Expect `{ simania_id: 64376, resolve_status: "wikidata" }` and no calls.
2. **NLI source:** the same with `hebrew_hint.source: "nli"` gives `resolve_status: "nli"`.
3. **Aurora stays unverified:** rec author `"Kim Stanley Robinson"`, book `{ simania_id: 1013521, title: "כיבוי אורות", author: "דייוויד קופ" }`, `match-by-author` stub returns `{ simania_id: null }`. Expect `null` and exactly one `match-by-author` call.
4. **Shades of Grey stays unverified:** rec author `"Jasper Fforde"`, book author `"אי. אל. ג'יימס"`. Same as case 3.
5. **No author:** rec author null or `""` gives the old behavior: one `match-by-author` call.
6. A `localizeRecommendations` test: one card shaped like case 1, with a stubbed Simania search that returns the 64376 book, leads to exactly one `link-edition` call with `simania_id: 64376`.
7. Existing tests pass.

# Acceptance criteria

1. The behavior above; `npm run test:web` passes.
