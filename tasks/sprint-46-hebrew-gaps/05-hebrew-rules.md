---
id: S46-T5
stage: 5
model_class: worker
timeout_minutes: 60
review: true
depends_on:
  - S46-T4
allowed_paths:
  - scripts/rematch-cached.ts
  - scripts/lib/dictionary.ts
  - tests/functions/rematch-hebrew-rules.test.ts
  - tests/functions/rematch-hebrew-dictionary.test.ts
  - tests/functions/rematch-hebrew.test.ts
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

Implement **Guard on Hebrew side (S46)** and **Hebrew dictionary step (S46)** exactly as `docs/contract.md` now says. Each of them is either on or off depending on the studies. Spend few tokens.

- **If the guard rule says it does not apply to `--hebrew`:** skip the `nli_english_mismatch` guard for `--hebrew` proposals only. English-side proposals keep it.
- **If the dictionary step is on:** when `resolveMatch` finds nothing for a `--hebrew` edition, translate the title with `scripts/lib/dictionary.ts`, search Hardcover, and apply the author agreement. Proposals use `via: "hebrew_dictionary"`. `--from --apply` accepts them.
- **If the dictionary step is off:** note that S45-T4 already added a Hebrew dictionary step to `--hebrew` (`hebrew_dictionary`, `scripts/rematch-cached.ts` around lines 714–799). **Remove that step and the S45 tests that expect it,** then add a test asserting that `--hebrew` never calls the dictionary and never emits `via: "hebrew_dictionary"`. `--from --apply` may still accept old `hebrew_dictionary` lines.
- **If the guard stays on for `--hebrew`:** change no guard code. Add a test asserting that a `--hebrew` proposal whose NLI original is an English title that disagrees is skipped as `nli_english_mismatch`.

# Acceptance criteria

1. `tests/functions/rematch-hebrew-rules.test.ts` covers both rules in the state the contract gives them, using fake providers under the real resolver.
2. Existing tests pass.
3. Both verification commands pass.
