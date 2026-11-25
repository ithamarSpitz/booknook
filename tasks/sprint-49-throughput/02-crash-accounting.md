---
id: S49-T2
stage: 2
model_class: worker
timeout_minutes: 40
review: true
depends_on:
  - S49-T1
allowed_paths:
  - supabase/functions/_shared/author-sound.ts
  - scripts/rematch-cached.ts
  - tests/functions/author-sound.test.ts
  - tests/functions/rematch-failure-detail.test.ts
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

Implement **Sound lookup input (S49)** and **Failure accounting (S49)** from `docs/contract.md`. Spend few tokens.

1. **Crash.** In `hebrewAuthorBySound` (`supabase/functions/_shared/author-sound.ts`), when `surnameSpellings(...)` returns no spellings (a surname with no Latin letters, for example Cyrillic or Hebrew), `lastS[0]` is `undefined`, the plan gets `[undefined, 50]`, and `query.includes("'")` throws `Cannot read properties of undefined (reading 'includes')`. This crashed a GitHub English shard on 2026-11-24. Fix it generally: return `null` before any search when there are no surname spellings, and drop any empty or missing query from the plan. Don't special-case any name.
2. **Accounting.** In `scripts/rematch-cached.ts`, `rememberFailure` writes to `currentFailures`, which is set to the work's `failures` array only around `findCandidates` and then set to `null`. Steps after that (the `decideMissedTranslation` wrappers for `nliOriginal` and `wikidataOriginal`, and any other later `rememberFailure` call) can mark the work failed while recording nothing. On 2026-11-25 this produced `{"skipped":"provider_failure","failures":[]}`. Keep `currentFailures` pointing at the work's array for the whole per-work body, and reset it in a `finally`.

# Acceptance criteria

1. `tests/functions/author-sound.test.ts` (create it if missing) checks that `hebrewAuthorBySound("Фёдор Достоевский", fake)` and `hebrewAuthorBySound("Иванов", fake)` return `null` and call the fake search 0 times, and that a normal Latin name still searches.
2. `tests/functions/rematch-failure-detail.test.ts` adds a case where only the `author_books` NLI step throws: the line is `provider_failure` with `failures` containing `{ provider: "nli", ... }`, never an empty array.
3. Existing tests pass unchanged.
4. Both verification commands pass.
