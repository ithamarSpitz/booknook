---
id: S39-T3
stage: 3
model_class: worker
timeout_minutes: 40
review: true
depends_on:
  - S39-T2
allowed_paths:
  - supabase/functions/_shared/authors.ts
  - supabase/functions/_shared/bridges.ts
  - scripts/lib/author-store.ts
  - tests/functions/authors.test.ts
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

Contract: "**Authors table (S39).**" (lookup logic). One module, with two storage adapters: Supabase client for the Edge Functions and `postgres` Sql for operator scripts. Nothing calls it yet; S39-T4 and S39-T5 wire it in.

# Scope

1. `supabase/functions/_shared/bridges.ts`: export `wikidataHebrewAuthorStrict(name)` and `wikidataEnglishAuthorStrict(name)`.
   - They do the same as the existing lookups, but throw `ProviderError` on a provider failure instead of returning null.
   - The existing `wikidataHebrewAuthor` and `wikidataEnglishAuthor` keep their behavior, by calling the strict ones and catching.
2. New `supabase/functions/_shared/authors.ts`:
   - `nameKey(name)`: `normalize(stripHebrewPoints(name))`, with whitespace collapsed.
   - `interface AuthorStore`:
     - `find(lang, key): Promise<{ author_id: string; wikidata_checked_at: string | null; names: AuthorNameRow[] } | null>`, where `names` are all names of that author;
     - `create(): Promise<string>`;
     - `addNames(authorId, names: { lang; name; source }[])`, which skips existing `(lang, name_key)` pairs;
     - `merge(keepId, dropId)`, which moves the names and deletes the dropped author;
     - `markWikidataChecked(authorId, at)`.
   - `catalogAuthorStore(db: CatalogDb): AuthorStore`, using only `from(...).select/eq/in/insert/update/delete`.
   - `async recordPair(store, he, en)`:
     - Do nothing when either name is empty or `nameSoundScore(he, [en]) < 0.8`.
     - Otherwise find both keys. Neither found → create an author with both names. One found → add the other name to it. Both found under different authors → `merge`, keeping the older one (the first found by English).
   - `async hebrewNames(store, en, deps = { wikidataHebrewAuthorStrict, now }): Promise<string[]>`:
     - Find the English key. When the author has `he` names, return them, link names before Wikidata names.
     - When `wikidata_checked_at` is within 30 days, return `[]`.
     - Otherwise call Wikidata. A name → store it with `source: "wikidata"` (creating the author when needed, with the English name too), mark it checked, and return `[name]`. Null → mark it checked and return `[]`.
     - If Wikidata throws, rethrow. Nothing is stored.
   - `async englishNames(store, he, deps = { wikidataEnglishAuthorStrict, now })` is the mirror.
3. New `scripts/lib/author-store.ts`: `sqlAuthorStore(sql: Sql): AuthorStore`, the same contract written with `postgres` tagged queries. `merge` runs in one transaction.

# Tests

New `tests/functions/authors.test.ts`. Use an in-memory `AuthorStore` that implements the interface over arrays, plus `catalogAuthorStore` over `tests/functions/helpers/fake-db.ts` where it supports the calls (otherwise test the adapter's query shape with a small stub):
1. `recordPair("אליס פיני", "Alice Feeney")` stores both names. `recordPair("הולי ג'קסון", "Alice Feeney")` stores nothing (sound < 0.8).
2. Two pairs joined by a third merge into one author, with all names kept.
3. `hebrewNames` with a stored `he` name → returns it, and Wikidata is not called (counter).
4. An unknown name → Wikidata is called once and stored. A second call → no Wikidata call.
5. Wikidata returns null → `[]`, checked. Within 30 days → no call; after 31 days → called again.
6. Wikidata throws → the error propagates, and nothing is stored or marked.
7. `englishNames` mirror: one stored case and one Wikidata case.
8. `wikidataHebrewAuthor` still returns null when the strict one throws (fetch stub returning 500 twice).

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
