---
id: S6-T6
stage: 3
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S6-T3
allowed_paths:
  - supabase/functions/recommendations/index.ts
  - tests/functions/recommendations-handler.test.ts
  - tests/functions/helpers/fake-db.ts
context:
  - contract
  - architecture.functions
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Every English-only recommendation card carries `hebrew_author`, the Hebrew name of its author, so the browser can search Simania by author.

# Scope

In `supabase/functions/recommendations/index.ts` (contract section "Hebrew author name"):

1. Export `hebrewAuthorFor(db, englishAuthor, deps, cache)`: normalized empty name → null. Catalog first (service client): editions with non-null `work_id` and non-empty `author` whose work's first `original_authors` entry equals the name after `normalize` (from `_shared/utils.ts`); take the most recently resolved edition's `author`. Read at most 50 works by that author with one query (for example `original_authors` contains the name, then compare normalized first entries in code) and at most one editions query. Else `deps.wikidataHebrewAuthor(englishAuthor)` (from `_shared/bridges.ts`, injectable). Else null. Cache results per normalized name in `cache` (a `Map`) for the run. Errors → null.
2. Export the existing default Hebrew-title hint function as `defaultHebrewHint(book)` (same behavior as today's `defaults.hebrewHint`), so the live gate can call it.
3. For each card returned with `simania_id` null, set `hebrew_author` from `hebrewAuthorFor` using the card's first author (one cache per request). Cards with a `simania_id` get `hebrew_author: null`. Do not store it.
4. Add `hebrewAuthor` to the dependency object so handler tests can inject it.

Do not change seeds, scoring, exclusion, self-healing or localization.

# Tests

In `tests/functions/recommendations-handler.test.ts` (keep existing tests):

1. Catalog has an edition by "פרידה מקפדן" linked to a work with `original_authors ["Freida McFadden"]`: an English-only card by Freida McFadden gets `hebrew_author: "פרידה מקפדן"` and Wikidata is not called.
2. No catalog entry: the injected Wikidata author bridge's answer is used; null when it returns null.
3. Localized cards get `hebrew_author: null`.
4. Two cards by the same author → one lookup (cache).

# Acceptance criteria

1. The behavior above, all tests passing.
