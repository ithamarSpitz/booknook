---
id: S33-T2
stage: 2
model_class: worker
timeout_minutes: 20
review: true
allow_protected: false
depends_on:
  - S33-T1
allowed_paths:
  - supabase/functions/_shared/catalog.ts
  - tests/functions/match-title.test.ts
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

`matchTitle` (`supabase/functions/_shared/catalog.ts`) collapses every run of whitespace inside the title into one space. Contract: "**Collapsed spaces (S33).**".

# Scope

- Only `matchTitle` changes. The existing bracket, parenthesis and other trimming stays the same, and so does its order.

# Tests

Add to `tests/functions/match-title.test.ts`:
1. `matchTitle("עולם חדש  מופלא")` is `עולם חדש מופלא`.
2. Tabs and newlines inside a title become one space.
3. `matchTitle("Title  (Hebrew)")` still drops the parenthesis and has no double space.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
