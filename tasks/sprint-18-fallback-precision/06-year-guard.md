---
id: S18-T6
stage: 3
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S18-T4
allowed_paths:
  - public/js/recs.js
  - tests/web/recs.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

The browser fallback never links an English book to a Hebrew edition published before the original, which is a sign that it's a different book by the same author.

# Scope

Contract: "Browser decision (`localizeFallback`)", step 3a "Year guard (S18)".

In `localizeFallback` in `public/js/recs.js` only:
1. Read `original_year` from the `hebrew-candidates` response.
2. For rules E and F, skip a Simania search result whose `year` is a number below `original_year − 1`.
3. For rule G, skip such a result before it becomes a found edition: no details read, no hits, and it does not count against other editions.
4. Rules A-D are unchanged. A missing or non-numeric `original_year` or `year` means no guard.

# Tests (`tests/web/recs.test.mjs`)

1. Rule G: with `original_year: 2023`, an edition from 2008 with 4 distinctive hits is not linked; with `original_year: 2005` it is.
2. Rule G: a skipped old edition does not block a newer edition. Its hits would have counted against it, but now the newer one wins.
3. Rule F: a 1990 result with `original_year: 2010` is skipped. A result from `original_year − 1` (2009) is accepted.
4. Rules A-D link an old edition regardless of `original_year`.
5. No `original_year` keeps today's behavior.
6. Existing tests pass.

# Acceptance criteria

1. The behavior above; `test:web` passes.
