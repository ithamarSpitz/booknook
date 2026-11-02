---
id: S7-T1
stage: 1
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - public/js/recs.js
  - tests/web/recs.test.mjs
  - tests/web/simania.test.mjs
  - scripts/verify-localization.ts
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
  - npm run check:functions
  - npm run verify:localization
---

# Goal

A Hebrew edition found by the recommendation title match is linked only when verified, so a recommendation never shows a different book's Hebrew edition.

# Why (live evidence, Nov 2026)

Itamar's recommendation "Aurora" by Kim Stanley Robinson (Hardcover 372879) was shown as "כיבוי אורות" (Simania 1013521), a different book by David Koepp. The NLI Hebrew hint for "Aurora" picked Koepp's book because its original title is also "Aurora"; the browser's `matchHebrewBook` found it and `link-edition` linked it with no author check (NLI creators are Hebrew, so the author never counted).

# Scope

Contract: "Title-match verification" (recommendations section).

1. `public/js/recs.js`: export `verifyTitleMatch(rec, book, deps)` returning `Promise<{ simania_id, resolve_status } | null>`, where `book` is the Simania search result (`{ id, title, author }`):
   - If `rec.hebrew_author` is set and `similarity(rec.hebrew_author, book.author ?? "") >= 0.6` (from `simania.js`), return `{ simania_id: book.id, resolve_status: rec.hebrew_hint?.source === "nli" ? "nli" : "wikidata" }` with no server call.
   - Otherwise call `match-by-author` with `{ work_id: rec.work_id, candidates: [{ simania_id: book.id, title: book.title, author: book.author ?? null }] }` and return its answer when `simania_id` is set (map `resolve_status` `fuzzy` to `nli`, as the author path does), else null. Failures return null.
2. `localizeRecommendations`: after the title match finds a book, link it only if `verifyTitleMatch` returns a result (use its `resolve_status` as the `link-edition` source); otherwise continue to the author path exactly as for a title miss. Keep concurrency, the author path and everything else unchanged.
3. `scripts/verify-localization.ts`: the title step must go through the same `verifyTitleMatch` (import it from `public/js/recs.js`, with deps whose `match-by-author` call runs the real `matchCandidates`). Add the case Hardcover 372879 "Aurora" / Kim Stanley Robinson, no seed, expected none. All existing cases must still pass.

# Tests (`tests/web/recs.test.mjs`, keep existing ones)

1. Title match whose author matches `hebrew_author` → linked, `match-by-author` not called.
2. Author mismatch, `match-by-author` confirms → linked with the returned source.
3. Author mismatch, `match-by-author` returns null → no `link-edition` for that book; the author path still runs.
4. No `hebrew_author` → `match-by-author` decides.

# Acceptance criteria

1. The behavior above; `test:web` passes; the live gate passes all cases including Aurora → none.

# Previous attempt (start here)

A previous attempt wrote this task's work and stopped only because the agent quota ran out. Apply `tasks/sprint-07-english-books/draft/S7-T1-changes.diff.txt` (for example `git apply`), review it against this brief, finish anything missing, then run the verification commands. Do not edit the draft files. The previous attempt also had to update mocks in `tests/web/simania.test.mjs`; that file is now allowed.
