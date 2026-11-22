---
id: S45-T3
stage: 3
model_class: worker
timeout_minutes: 60
review: true
depends_on:
  - S45-T2
allowed_paths:
  - scripts/rematch-cached.ts
  - supabase/functions/_shared/catalog.ts
  - tests/functions/rematch-explain.test.ts
  - tests/functions/rematch-hebrew.test.ts
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

Implement part 1 of **Hebrew direction (S45)**, the `--explain` object. Spend few tokens.

Add an optional trace hook to `resolveMatch` (for example `api.trace?.(event)`). Without the hook, nothing changes. Call it at each step:
- the original and its source;
- the English author and its source;
- each Hardcover search, with its result count and its best title and score;
- the reason it stopped.

`--explain` is allowed only with `--hebrew`. Change no matching decision.

# Acceptance criteria

1. `tests/functions/rematch-explain.test.ts` covers every `stop` value with fake providers.
2. The same fixtures run without `--explain` give byte-identical output.
3. Both verification commands pass.
