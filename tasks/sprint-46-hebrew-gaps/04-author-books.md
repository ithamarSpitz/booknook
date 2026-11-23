---
id: S46-T4
stage: 4
model_class: worker
timeout_minutes: 60
review: true
depends_on:
  - S46-T3
allowed_paths:
  - scripts/rematch-cached.ts
  - scripts/measure-links.ts
  - tests/functions/rematch-author-books.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "const t=require('fs').readFileSync('scripts/rematch-cached.ts','utf8');if(!t.includes('decideMissedTranslation'))throw new Error('reuse decideMissedTranslation from measure-links.ts, do not copy it');if(!t.includes('author_books'))throw new Error('via author_books')"
---

# Goal

Implement **Author books path (S46)**. Spend few tokens.

`measure:links` already proves misses with `decideMissedTranslation` in `scripts/measure-links.ts`. It found 22 in a sample of 400 that the rematch never linked; the titles are in `tasks/sprint-46-hebrew-gaps/data/measure-all.json`. **Reuse that function, don't copy it.**

In the English-side `rematch:cached`, when every current source gives no proposal and no provider failed:
1. Call `decideMissedTranslation` for the work.
2. If it returns a Simania book, build a normal proposal with `via: "author_books"` and the book's `simania_id`, `book_id` and `hebrew_title`.
3. Run the author agreement and the S43 `nli_english_mismatch` guard on it, like any other proposal.

`--from … --apply` must accept `via: "author_books"` lines. If `decideMissedTranslation` returns only a title or a flag, extend its result with the Simania id and keep its existing callers working.

# Acceptance criteria

1. `tests/functions/rematch-author-books.test.ts`, with fake providers under the real `decideMissedTranslation`, covers:
   - a work with no other proposal, whose Hebrew author has a Simania book whose NLI original equals the English title → an `author_books` proposal;
   - the same case where the author agreement fails → no proposal;
   - another source already proposed → `decideMissedTranslation` is not called;
   - a provider failed → not called;
   - an `author_books` line from `--from` with `--apply` → linked.
2. The existing `measure-links` and rematch tests pass unchanged.
3. All verification commands pass.
