---
id: S30-T10
stage: 3
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S30-T2
  - S30-T9
allowed_paths:
  - supabase/functions/_shared/hardcover.ts
  - tests/functions/hardcover-retry.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

The `retryWithAuthor` retry in `findHardcoverBook` (`supabase/functions/_shared/hardcover.ts`) also scores against the search document's `alternative_titles`. Contract: "**Hardcover alternative titles (S30).**". The first pass and all other callers are unchanged. Put no book-specific constants in the code.

# Scope

- In the retry only, the search query asks for `{ ids results }`.
  - Read `results.hits[].document`, with `id` (a string) and `alternative_titles` (a string array, may be missing), and map them by numeric id.
  - Details still come from `hardcoverBooks(ids)`.
  - The retry title Dice is the maximum over the full title, the part before the first `:`, and each alternative title of that book. Missing or malformed `results` means no alternative titles.
- Everything else in the retry, and the first pass, stays as S30-T2 left it.

Note: the agent cannot reach Hardcover. The `results` shape above was verified live on 2026-11-21: `search(...){ results }` returns `{ found, hits: [{ document: { id: "101133", title, alternative_titles: [...], author_names, users_count, ... } }] }`.

Reviewer must check: the retry query text requests both `ids` and `results`, and the parser follows the shape above exactly (`hits[].document.id` is a string).

# Tests

In `tests/functions/hardcover-retry.test.ts`:
1. **Ferrante.** The first search `Storia di chi fugge e di chi resta` returns 101133 `Those Who Leave and Those Who Stay` by `Elena Ferrante`. The retry `Storia di chi fugge e di chi resta Elena Ferrante` returns 101133 with `results.hits[0].document.alternative_titles` containing `Storia di chi fugge e di chi resta`. With `retryWithAuthor: true` and hint `Elena Ferrante`, the result is 101133.
2. The same with no `results` in the retry answer: the result is `null`.
3. An alternative title that matches but a different author: `null` (author evidence is still required).
4. The S30-T2 tests still pass. Update their stub so that the retry query may also request `results`.

# Acceptance criteria

1. The behavior above; both verification commands pass.
