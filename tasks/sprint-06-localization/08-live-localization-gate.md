---
id: S6-T8
stage: 5
model_class: worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on:
  - S6-T5
  - S6-T7
allowed_paths:
  - scripts/verify-localization.ts
  - scripts/verify-resolution.ts
  - package.json
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run verify:resolution
  - npm run verify:localization
---

# Goal

Live gates that prove, against real Wikidata, NLI, Hardcover and Simania, that recommendations find Hebrew editions where they exist, stay English where none exists, and that resolution never links a book to a different book.

# Scope

1. New `scripts/verify-localization.ts` (Deno; same conventions as `scripts/verify-resolution.ts`: `HARDCOVER_API_KEY` from env or `BOOKNOOK_ENV_FILE`, never printed; in-memory `FakeDb`; sequential; one retry after 5 s when a provider fails). For each case: fetch the Hardcover book with the real `hardcoverBooks([id])`; run the real chain exactly as production does:
   - `defaultHebrewHint(book)` (from `supabase/functions/recommendations/index.ts`); if it returns a title, the browser's `matchHebrewBook(title, author)` (from `public/js/simania.js`).
   - If no Simania id yet: `hebrewAuthorFor(db, firstAuthor, deps, new Map())` (real Wikidata bridge) → `searchByAuthor(name)` (browser module, live Simania) → `matchCandidates(db, hardcoverId, candidates, deps)` (from `supabase/functions/match-by-author/index.ts`, real `ensureResolved`).
   - Compare the final Simania id with the expected one.

   | Hardcover | title / author | FakeDb seed | expected Simania id |
   |---|---|---|---|
   | 383752 | Spin / Robert Charles Wilson | none | 97171 (סחרור) |
   | 261931 | A Man Called Ove / Fredrik Backman | none | 971989 (איש ושמו אובה) |
   | 475182 | A Flicker in the Dark / Stacy Willingham | none | 1004934 (הבהוב באפלה) |
   | 585562 | The Housemaid's Secret / Freida McFadden | edition 1024000 "עוזרת הבית" by "פרידה מקפדן" linked to a work with `original_authors ["Freida McFadden"]`, `hardcover_id` 0 | 1024882 (הסוד של עוזרת הבית) |
   | 381100 | The Dead Zone / Stephen King | none | none (Simania has no Hebrew edition) |
   | 572355 | Never Lie / Freida McFadden | same seed as above | none (not on Simania) |

   Print one line per case with the path that produced the result (title or author) and exit non-zero on any mismatch.
2. `scripts/verify-resolution.ts`: keep all cases and add two "never link to the wrong book" cases: Simania 34027 "נערה בנוף" by "ג'ונתן לת'ם" passes when the result is `not_found` or Hardcover 473787, and fails on 483014 or any other id; Simania 1013521 "כיבוי אורות" by "דיוויד קופ" passes on 559469 or `not_found`, fails on 372879 or any other id.
3. `package.json`: add `"verify:localization": "deno run --allow-net --allow-env --allow-read scripts/verify-localization.ts"`; change nothing else.

# Rules

Live calls are allowed only in these gate scripts. Do not change application code in this task; if a case fails because of application behavior, report the printed output in `OPEN_ISSUES` instead of weakening the case.

# Acceptance criteria

1. Both gates pass all cases against the merged code of this sprint.
