---
id: S39-T6
stage: 5
model_class: worker
timeout_minutes: 40
review: true
depends_on:
  - S39-T5
allowed_paths:
  - supabase/functions/_shared/bridges.ts
  - scripts/lib/dictionary.ts
  - scripts/lib/rematch.ts
  - scripts/rematch-cached.ts
  - tests/functions/dictionary.test.ts
  - tests/functions/rematch-lib.test.ts
  - tests/functions/rematch-cached.test.ts
  - tests/functions/rematch-from-file.test.ts
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

Contract: "**Dictionary last resort (S39).**". It is the final step of `rematch:cached` for works where nothing else worked.

# Scope

1. `supabase/functions/_shared/bridges.ts`: `wiktionaryGlosses(word): Promise<string[]>`.
   - `GET https://en.wiktionary.org/api/rest_v1/page/definition/<encodeURIComponent(word)>` through `providerFetch`.
   - It returns the `definition` strings of the `he` sections, with HTML tags removed, lowercased.
   - A 404 → `[]`. Any other non-OK → `ProviderError`.
2. New `scripts/lib/dictionary.ts`:
   - `wordForms(word)`: the word; without one leading `ה ו ב ל מ ש כ` when longer than 2; without a leading letter plus `ה` when longer than 3; for each form, a trailing `ים`/`ות` removed, a trailing `ת`→`ה`, and a trailing `י`→`ים`.
   - `async dictionaryScore(hebrewTitle, englishTitle, glosses)`:
     - English content words are the lowercased `a-z` words, minus `the a an of and to in on for with by`.
     - For each Hebrew word, the glosses of its first form that has any.
     - A content word is covered when the joined glosses contain it as a whole word, or start a word with it after removing a trailing `ies|es|s|er|ing|ed`.
     - The score is covered ÷ content words, or 0 when there are none.
     - Glosses are cached per word.
   - `pickByDictionary(englishTitle, candidates: {simania_id, title}[], glosses)`: the candidate with the highest score, only when it is `>= 0.5` and strictly higher than every other one. Otherwise null.
3. `scripts/lib/rematch.ts`: `findCandidates` also returns `authorBooks`, the kept reverse-step books (id and title), so the CLI can use them.
4. `scripts/rematch-cached.ts`:
   - The dictionary step runs when a work has no proposal, its skip reason would be `no_candidate` or `rejected`, nothing failed, and `authorBooks` is not empty.
   - It runs `pickByDictionary(work.original_title, authorBooks, wiktionaryGlosses)`.
   - A pick becomes a proposal with `via: "dictionary"`, `status: "dictionary"`, and `book_id` the work's own `hardcover_id`. There is no `resolveMatch` confirmation.
   - A Wiktionary error → `provider_failure`.
   - `--apply` and `--from` treat `dictionary` like the other statuses. The `--from` parser accepts `"dictionary"`.

# Tests

New `tests/functions/dictionary.test.ts`, with stub glosses taken from real Wiktionary answers on 2026-11-21:
1. `dictionaryScore("עשב", "Grass")` is 1 when `עשב` → `["grass"]`.
2. `pickByDictionary("Thinner", [רזה, זה, הניצוץ])`, with `רזה` → `["thin, lean"]` and the others → `[]`, picks `רזה`.
3. `pickByDictionary("The Nickel Boys", [נערי ניקל, מחתרת המסילה])`, with `נער` → `["boy, youth"]`, picks `נערי ניקל` (score 0.5).
4. A tie of two candidates at 1 → null. A best of 0.4 → null.
5. `wordForms("והבית")` includes `בית`.
6. `wiktionaryGlosses`: a 404 → `[]`, a 500 twice → `ProviderError`, and only `he` sections are read.
7. CLI: a work with `no_candidate` and author books gets a `dictionary` proposal with `book_id` equal to its `hardcover_id`. A failing glosses call → `provider_failure`.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
