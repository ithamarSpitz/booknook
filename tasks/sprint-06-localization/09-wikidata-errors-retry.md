---
id: S6-T9
stage: 5
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S6-T5
  - S6-T7
allowed_paths:
  - supabase/functions/_shared/bridges.ts
  - supabase/functions/_shared/catalog.ts
  - tests/functions/helpers/fake-db.ts
  - tests/functions/wikidata-errors.test.ts
  - tests/functions/author-bridges.test.ts
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

A Wikidata error is a provider failure (the edition stays `pending` and is retried), never a silent "no match" that marks a book `not_found`.

# Why (live evidence, Nov 2026)

The live gate `verify:resolution` intermittently got `not_found` for Simania 956502 "עין החתול [מהדורת 2011]" (Cat's Eye, Hardcover 94555), which normally resolves via Wikidata. Under load the Wikidata API can answer HTTP 200 with a JSON body `{"error": {...}}` and no `search` / `entities` field; `wikidataOriginal` and `wikidataEntity` in `bridges.ts` read that as an empty result. In the same run `wikidataEnglishAuthor` (which swallows every error) returned null, so the NLI path had only a Hebrew author, the ambiguity rule refused, and the edition was stored `not_found`. Per the contract, provider failures must leave it `pending`.

# Scope

1. `supabase/functions/_shared/bridges.ts`: every Wikidata API read (search and entity) throws `ProviderError` when the JSON has an `error` field, or when the expected `search` (search) or `entities` (entity read) field is missing. Use one small private helper. Recommendation-only wrappers that return null on errors (`wikidataHebrew`, `wikidataHebrewAuthor`) keep returning null.
2. `wikidataEnglishAuthor`: keep returning null for "no such human", but let `ProviderError` propagate (throw) instead of returning null. In `supabase/functions/_shared/catalog.ts`, `ensureResolved` treats a throw from it like other provider failures: count it as a failure (so a no-match outcome becomes `pending`) and continue with the NLI creator as the hint.
3. `tests/functions/helpers/fake-db.ts`: inserted `works` rows without an `id` get unique ids (`work-1`, `work-2`, ... per FakeDb instance) instead of always `work-1`. Existing tests that rely on the first work being `work-1` must keep passing; do not change other behavior.

# Tests

New `tests/functions/wikidata-errors.test.ts`, stubbed `fetch`:

1. Search answering 200 with `{"error":{"code":"maxlag"}}` → `wikidataOriginal` throws `ProviderError`.
2. Entity read with no `entities` field → throws.
3. `wikidataEnglishAuthor`: error body → throws; valid empty search → null.
4. `ensureResolved` (fake DB, provider overrides): Wikidata bridge throws, NLI gives a title, `wikidataEnglishAuthor` throws, Hardcover returns no match → edition `pending`, not `not_found`.
5. FakeDb: two inserted works get different ids.

# Acceptance criteria

1. The behavior above; all tests pass. The only existing test that changes is `tests/functions/author-bridges.test.ts` "wikidata author bridges return null on fetch failure": keep its `wikidataHebrewAuthor` assertion (still null) and change the `wikidataEnglishAuthor` assertion to expect a `ProviderError` throw (the new rule). Change nothing else in that file.

# Previous attempt (start here)

A previous attempt implemented everything; it failed only on that one existing test, which it was not allowed to edit. Apply `tasks/sprint-06-localization/draft/T9-changes.diff.txt` (for example `git apply`), update that one test as described, then run the verification commands. Do not edit the draft files.
