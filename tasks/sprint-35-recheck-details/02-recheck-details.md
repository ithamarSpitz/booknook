---
id: S35-T2
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S35-T1
allowed_paths:
  - scripts/recheck-links.ts
  - tests/functions/recheck-links.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

`recheck:links --apply` writes full book details for every relink. Contract: "**Recheck fetches details before a relink (S35).**".

# Scope

In `scripts/recheck-links.ts`:
- Add `hardcoverBooks` (from `supabase/functions/_shared/hardcover.ts`) to `RunDeps` and `runDefaults`, so tests can override it.
- In the `--apply` loop, before `deps.applyRepair` for a relink:
  - check the plan's book with `isSearchDocumentBook` (from `hardcover.ts`);
  - if it was built from search documents, call `deps.hardcoverBooks([book.id])` once and use the returned book as both `plan.book` and `plan.proposal.book`;
  - if the call throws or returns no book, skip the relink: count it in `skipped`, log `{"simania_id":…, "skipped":"details_failure"}`, and don't call `applyRepair` for it.
- A book that already has details (not from search documents) is applied as today, with no extra request.
- Dry-run output and every other behavior stay unchanged.

# Tests

Add to `tests/functions/recheck-links.test.ts`, with stubbed deps (no network or database):
1. Make a relink book with `findHardcoverBook` from a fetch-stubbed search response that has full `results.hits[].document`, so it is a search-document book. With `--apply`, the `hardcoverBooks` stub returns the book with `cached_similar_book_ids: [7]`. `applyRepair` receives a plan whose `book` and `proposal.book` have `cached_similar_book_ids` [7].
2. `hardcoverBooks` throws: `applyRepair` is not called, the summary has `skipped: 1`, and a `details_failure` line is logged.
3. A plain object book (not from search documents): `hardcoverBooks` is not called.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
