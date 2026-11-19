---
id: S21-T3
stage: 3
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S21-T2
allowed_paths:
  - public/js/hebrew-fallback.js
  - scripts/audit-authors.ts
  - package.json
  - tests/web/hebrew-fallback.test.mjs
  - tests/functions/audit-authors.test.ts
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

A pure author-guard predicate exists. A read-only audit lists every existing link that the predicate would reject, so the operator can review the guard before it goes live and find old wrong links.

# Scope

Contract: "Author guard (browser, S21)" (the predicate only) and "`npm run audit:authors`".

1. `public/js/hebrew-fallback.js`: export `authorGuardRejects(simaniaAuthor, englishAuthors, hebrewAuthor)` exactly as the contract defines it. Use the existing `nameSoundScore` and `similarity` imports or helpers.
2. New `scripts/audit-authors.ts`:
   - read-only (`openProdDb({ readOnly: true })`);
   - the query: linked editions with `simania_id > 0` whose work is used by any reader (an edition on `shelf_books`, or the work in `recommendations` or `genre_recommendations`), with the work's `hardcover_id`, `original_title` and `original_authors`;
   - output: JSON lines and the totals as the contract says.
3. `package.json`: add `"audit:authors": "deno run --allow-net --allow-env --allow-read --allow-sys scripts/audit-authors.ts"`. Nothing else in that file.

The browser does not call the predicate yet; S21-T5 does that.

# Tests

1. `tests/web/hebrew-fallback.test.mjs`:
   - rejects וויליאם פיטר בלאטי vs ["Kazue Kato"];
   - accepts ג'ו היל vs ["Joe Hill"];
   - accepts an empty or Latin Simania author;
   - accepts when the `hebrewAuthor` bridge agrees, even with a low sound score;
   - a work with two English authors accepts a match to the second.
2. `tests/functions/audit-authors.test.ts`: the row filter and output builder, tested as pure functions with fixture rows. Export them from the script for testing, the way the other operator scripts do.

# Acceptance criteria

1. The behavior above; `check:functions`, `test:functions` and `test:web` pass.
