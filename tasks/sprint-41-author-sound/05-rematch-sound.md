---
id: S41-T5
stage: 5
model_class: worker
timeout_minutes: 40
review: true
depends_on:
  - S41-T4
allowed_paths:
  - scripts/rematch-cached.ts
  - tests/functions/rematch-sound.test.ts
  - tests/functions/rematch-cached.test.ts
  - tests/functions/rematch-from-file.test.ts
  - tests/functions/rematch-author-agreement.test.ts
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

Contract: "**Author by sound (S41).**". `rematch:cached` uses the sound lookup as the last source of an author's Hebrew name.

# Scope

1. In `scripts/rematch-cached.ts`, the `hebrewNames` dependency given to `findCandidates` keeps its current order: stored names, then the batched Wikidata names.
   - When both are empty, it returns `soundNames(store, name, (en) => deps.hebrewAuthorBySound(en), deps.now)`.
   - `deps.hebrewAuthorBySound` defaults to `(en) => hebrewAuthorBySound(en, deps.searchBooks)` (from `_shared/author-sound.ts`), and tests can inject it.
2. A thrown sound lookup counts as `provider_failure` for that work, like any other provider failure today. The run continues with the next work.
3. No other behavior changes, including the forward step, confirmation, the author agreement, `--from`, and the Hardcover budget. The sound lookup makes no Hardcover calls.

# Tests

New `tests/functions/rematch-sound.test.ts`:
1. A work by Julia Walton with no stored or Wikidata name: the injected lookup returns `ג'וליה וולטון`, and the Simania author search then uses that name (assert the recorded `searchBooks` query).
2. A stored name exists → the lookup is not called.
3. A throwing lookup → `provider_failure` for that work, and the next work is still processed.

Existing tests pass. Update them only where the new dependency must be added to their deps object.

# Acceptance criteria

1. The behavior above; both verification commands pass.
