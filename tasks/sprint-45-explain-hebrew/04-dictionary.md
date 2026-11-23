---
id: S45-T4
stage: 5
model_class: worker
timeout_minutes: 60
review: true
depends_on:
  - S45-T3
  - S45-T3b
allowed_paths:
  - scripts/rematch-cached.ts
  - tests/functions/rematch-hebrew.test.ts
  - tests/functions/rematch-hebrew-dictionary.test.ts
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

If `docs/contract.md` **Hebrew direction (S45)** has part 2, implement it. If it doesn't, make no code change and add only a test asserting that `--hebrew` has no `hebrew_dictionary` via. Spend few tokens.

Part 2: when `resolveMatch` finds nothing for an edition in `--hebrew`, try the dictionary English title through the same Hardcover search, author agreement and `nli_english_mismatch` guard. Proposals from this step use `via: "hebrew_dictionary"`. Reuse `scripts/lib/dictionary.ts`; don't duplicate it.

# Acceptance criteria

1. Tests with fakes cover:
   - a dictionary hit with the author agreeing → proposal;
   - the author disagreeing → no proposal;
   - the guard rejecting → `nli_english_mismatch`;
   - `resolveMatch` succeeding → the dictionary is not called.
2. Both verification commands pass.
