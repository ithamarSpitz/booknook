---
id: S22-T3
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S22-T1
allowed_paths:
  - public/js/hebrew-fallback.js
  - scripts/audit-authors.ts
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

The author guard never blocks a book with no English author or a Hebrew-original book, and the audit can check every linked edition.

# Scope

Contract: "Guard precision (S22)" (the two new never-reject rules) and the `--all` sentence in "`npm run audit:authors`".

1. `public/js/hebrew-fallback.js`, `authorGuardRejects`: before scoring, return false when `englishAuthors` has no non-empty entry, or when every non-empty entry contains a Hebrew letter.
2. `scripts/audit-authors.ts`:
   - `authorRowIsRejected` gets the same two rules;
   - `--all` drops the "used by a reader" condition from the query;
   - `totals.scope` is "all" or "used".

   Still read-only.
3. Nothing else changes. `nameSoundScore` is S22-T2's job; do not edit `names.js`.

# Tests

1. `hebrew-fallback.test.mjs`:
   - `authorGuardRejects("רוברט מ. פירסיג", [], "")` is false;
   - so is `authorGuardRejects("גלית דיסטל אטבריאן", ["גלית דיסטל אטבריאן"], "")`;
   - `[""]` counts as no author;
   - the S21 reject case (וויליאם פיטר בלאטי vs Kazue Kato) still rejects.
2. `audit-authors.test.ts`:
   - the same two rules on fixture rows;
   - the `--all` query has no reader-use condition and the default one does (test the query builder or flag parsing as a pure function);
   - `scope` is set in the totals.

# Acceptance criteria

1. The behavior above; `check:functions`, `test:functions` and `test:web` pass.
