---
id: S41-T4
stage: 4
model_class: worker
timeout_minutes: 40
review: true
allow_protected: true
depends_on:
  - S41-T3
allowed_paths:
  - supabase/migrations/20261122000200_author_sound.sql
  - supabase/functions/_shared/authors.ts
  - supabase/functions/_shared/types.ts
  - scripts/lib/author-store.ts
  - scripts/lib/link-proposal.ts
  - supabase/functions/_shared/catalog.ts
  - tests/functions/authors.test.ts
  - tests/functions/authors-sound-store.test.ts
context:
  - contract
  - architecture.matching
  - architecture.data_model
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Contract: "**Author by sound (S41).**". Store names found by sound, and check each author by sound at most once per 30 days.

# Scope

1. **Migration** `supabase/migrations/20261122000200_author_sound.sql`:
   - `author_names.source` also allows `'sound'`. Replace the existing check constraint (from `20261122000100_authors.sql`).
   - `authors` gets `sound_checked_at timestamptz` (nullable).
2. **Types:**
   - `AuthorNameRow.source` (`_shared/types.ts`) and `NewAuthorName.source` (`_shared/authors.ts`) include `"sound"`;
   - `FoundAuthor` gets `sound_checked_at: string | null`;
   - `AuthorStore` gets `markSoundChecked(authorId, at)`.

   Implement these in `catalogAuthorStore` and in `sqlAuthorStore` (`scripts/lib/author-store.ts`), the same way `wikidata_checked_at` and `markWikidataChecked` are done today. The other `AuthorStore` objects (the no-write store in `_shared/catalog.ts`, the one in `scripts/lib/link-proposal.ts`) get the method in the same style as their `markWikidataChecked`, and nothing else changes in those files.
3. **New export** `soundNames(store, en, lookup, now)` in `_shared/authors.ts`, where `lookup(en)` returns `Promise<string | null>` (the operator passes `hebrewAuthorBySound`):
   - Stored Hebrew names of that English author (any source) → return them, with no lookup.
   - Else, when `sound_checked_at` is less than 30 days old → `[]`, with no lookup.
   - Else, call `lookup`. A thrown error propagates and nothing is stored.
   - On success: create the author if missing (English name, source `wikidata`, as `namesFor` does). Store a found name as `{ lang: "he", source: "sound" }`, set `sound_checked_at`, and return `[name]` or `[]`.
4. **Ordering:** wherever stored names are returned (`namesFor`, `soundNames`), sort by source `link` first, then `wikidata`, then `sound`.
5. **Unchanged:** `hebrewNames`, `englishNames` and `recordPair` keep their behavior. Edge Functions never call `soundNames`.

# Tests

New `tests/functions/authors-sound-store.test.ts`, using an in-memory `AuthorStore` stub:
1. No stored name: the lookup returns `ג'וליה וולטון` → stored with source `sound`, `sound_checked_at` set, and returned.
2. A stored `link` name → returned, with no lookup.
3. Lookup null → `[]`. A second call within 30 days makes no lookup; after 31 days it looks up again.
4. Lookup throws → it rethrows; no name is stored and `sound_checked_at` is not set.
5. Stored names `sound`, `link`, `wikidata` come back as `link`, `wikidata`, `sound`.

If a test in `tests/integration/` lists `author_names` sources or `authors` columns, stop and report it; do not edit it.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
