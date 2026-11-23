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
- **For whichever rule is off,** change no code for it and add a test that asserts it stays off.

# Acceptance criteria

1. `tests/functions/rematch-hebrew-rules.test.ts` covers both rules in the state the contract gives them, using fake providers under the real resolver.
2. Existing tests pass.
3. Both verification commands pass.
