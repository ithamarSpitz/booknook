---
id: S18-T5
stage: 3
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S18-T3
allowed_paths:
  - supabase/functions/_shared/hebrew-candidates.ts
  - tests/functions/hebrew-candidates.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Rule G no longer counts short English names, which sound-match ordinary Hebrew words, as evidence.

# Scope

Contract: rule **G.** (`english_names` holds capitalized words of length ≥ 5; "Choice" on the stop list) and the 2026-11-19 measured cases.

In `supabase/functions/_shared/hebrew-candidates.ts` only (`extractEnglishNames` and its stop list):
1. The minimum word length is 5 instead of 3.
2. Add "Choice" to the common-word stop list.
3. Nothing else changes.

# Tests (`tests/functions/hebrew-candidates.test.ts`)

1. A description containing "Beth", "Wood", "Poe" and "Choice" gives none of them; "Thoreau" and "Chicago" still appear (the year guard handles those).
2. The names of the known good rule G cases are kept: "Tricia" and "Ethan" (Never Lie).
3. Existing tests pass, updated only where the length rule changes their expected names.

# Acceptance criteria

1. The behavior above; `check:functions` and `test:functions` pass.
