---
id: S36-T3
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S36-T1
allowed_paths:
  - supabase/functions/_shared/hardcover.ts
  - supabase/functions/_shared/types.ts
  - supabase/functions/recommendations/index.ts
  - tests/functions/hc-hebrew-hint.test.ts
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

When Wikidata and NLI give no Hebrew hint, the recommendation hint comes from a Hebrew-language Hardcover edition. Contract: "**Hardcover Hebrew edition hint (S36).**" (server part).

# Scope

1. In `supabase/functions/_shared/hardcover.ts`, add `hardcoverHebrewEdition(bookId: number): Promise<string | null>`.
   - It makes one GraphQL request: `editions(where:{book_id:{_eq:<id>}, language:{code2:{_eq:"he"}}}, order_by:[{users_count:desc},{id:asc}], limit:1) { title }`.
   - It returns the trimmed title, or null when there is none.
   - It throws on HTTP or GraphQL errors, like the other helpers.
2. In `supabase/functions/_shared/types.ts`:
   - `HebrewHint.source` also allows `"hardcover"`;
   - `ResolveStatus` also includes `"hardcover"`.
3. In `defaultHebrewHint` (`supabase/functions/recommendations/index.ts`):
   - Add `hardcoverHebrewEdition` to its injectable `bridges` parameter, defaulting to the real one.
   - When both Wikidata and NLI give nothing, call it once with `book.id`. If it returns a title, return `{ source: "hardcover", title, author: null }`.
   - If it throws, return null.
   - Nothing else changes; the Wikidata and NLI branches don't call it.

# Tests

New `tests/functions/hc-hebrew-hint.test.ts`, with no network:
1. `hardcoverHebrewEdition` with a fetch stub: the request body has `language` `code2` `he`, `book_id` `_eq` 325603, and `limit:1`, and the function returns `רזה`.
2. An empty `editions` array gives null.
3. `defaultHebrewHint` with stub bridges: Wikidata null, NLI null, Hardcover `רזה` → `{ source: "hardcover", title: "רזה", author: null }`.
4. With a Wikidata hint, the Hardcover bridge is never called (use a counter).
5. The Hardcover bridge throws → null.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
