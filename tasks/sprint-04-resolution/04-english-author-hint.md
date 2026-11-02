---
id: S4-T4
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S4-T2
allowed_paths:
  - supabase/functions/_shared/catalog.ts
  - tests/functions/author-hint.test.ts
  - tests/functions/helpers/fake-db.ts
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

The NLI path gives Hardcover an English author hint learned from the catalog, so the right book wins among same-title books.

# Why (live evidence, Nov 2026)

NLI returns creators in Hebrew ("פולי, לוסי"), which never matches Hardcover contributor names, so the author boost never applies. Hardcover search for "Paris apartment" returns four books titled The Paris Apartment (Lucy Foley 463025, Kelly Bowen 512180, Sophia Karlson 564957, and one with no author); Foley wins today only by popularity. The catalog already knows the English name: the edition "רשימת המוזמנים" by the same Simania author "לוסי פולי" is linked to a work whose `original_authors` is `["Lucy Foley"]`.

# Scope

In `supabase/functions/_shared/catalog.ts`, inside `ensureResolved`, only on the NLI path:

1. Add a helper `englishAuthorHint(db, edition): Promise<string | null>`: if `edition.author` is empty return null; otherwise read other `editions` rows with exactly the same `author`, a non-null `work_id`, and a different `simania_id`, the most recently resolved first (`resolved_at` desc), at most 5; then read their works' `original_authors` and return the first non-empty first author, or null. A database error makes it return null (never fails resolution). At most two catalog reads.
2. When the NLI bridge is accepted, call `findHardcoverBook(bridge.title, hint ?? bridge.author)`. Compute the hint only when the NLI bridge exists.

The Wikidata path and the direct fuzzy path are unchanged. Keep the match-title behavior from S4-T2. If the fake DB lacks a query method you need (for example `neq`, `not`, `order`, `limit`, `in`), add it to `tests/functions/helpers/fake-db.ts` without changing existing behavior.

# Tests

New file `tests/functions/author-hint.test.ts` (fake DB and provider overrides, no live calls):

1. Catalog has "רשימת המוזמנים" (author "לוסי פולי") linked to a work with `original_authors ["Lucy Foley"]`; resolving "הדירה בפריז" (author "לוסי פולי") through an NLI bridge `{ title: "Paris apartment", author: "פולי, לוסי" }` calls `findHardcoverBook("Paris apartment", "Lucy Foley")`.
2. No other linked edition by that author: the hint is the NLI creator, as today.
3. Linked editions by a different author are ignored; an edition with null `work_id` is ignored.
4. The Wikidata path never reads the catalog for a hint.

# Acceptance criteria

1. The behavior above, with all tests passing, including the existing catalog tests.
