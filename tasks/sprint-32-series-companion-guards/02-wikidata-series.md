---
id: S32-T2
stage: 2
model_class: worker
timeout_minutes: 20
review: true
allow_protected: false
depends_on:
  - S32-T1
allowed_paths:
  - supabase/functions/_shared/bridges.ts
  - tests/functions/wikidata-series.test.ts
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

The Wikidata bridge (`supabase/functions/_shared/bridges.ts`) skips series entities. Contract: "**Series entities (S32).**".

# Scope

- Add `Q1667921`, `Q13593966` and `Q7725310` to `REJECT_TYPES` (`Q277759` is already there).
- Rejection must win over the "has a P50 author" acceptance, as it already does for films. Confirm that in the code and keep it that way.
- Change nothing else.

# Tests

New `tests/functions/wikidata-series.test.ts`, with a fetch stub in the style of the existing Wikidata tests:
1. The search returns Q45875 (P31 `Q1667921`, P50 set, English label `A Song of Ice and Fire`) first, then Q1052826 (P31 `Q7725634`, English label `A Game of Thrones`). The bridge returns `A Game of Thrones`.
2. An entity with P31 `Q13593966` and a P50 author is skipped.
3. An entity with P31 `Q8261` (novel) is still accepted.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
