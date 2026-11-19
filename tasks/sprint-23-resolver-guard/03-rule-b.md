---
id: S23-T3
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S23-T1
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

A Hebrew title that is a transliteration of the English title becomes a rule B candidate from a sound score of 0.7, so Shutter Island → 85002 שאטר איילנד can be linked.

# Scope

Contract: rule B in `hebrew-candidates` (S23). In `supabase/functions/_shared/hebrew-candidates.ts`, change only the rule B threshold from 0.85 to 0.7. Keep it a named constant if it is one.

# Tests (`hebrew-candidates.test.ts`)

1. With stubbed NLI records for author "Lehane, Dennis":
   - "שאטר איילנד" (no original) is a **B** candidate for "Shutter Island";
   - "מיסטיק ריבר" is not B for "Shutter Island".
2. A record whose title scores below 0.7 stays G. Compute the score in the test with `nameSoundScore` to show it is below 0.7.
3. Existing tests pass. If an existing test pinned 0.85 behavior with a title that scores between 0.7 and 0.85, update only that expectation, and say so in your final message.

# Acceptance criteria

1. The behavior above; `check:functions` and `test:functions` pass.
