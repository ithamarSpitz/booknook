---
id: S31-T8
stage: 5
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S31-T2
  - S31-T3
  - S31-T4
  - S31-T5
  - S31-T6
  - S31-T7
allowed_paths:
  - docs/architecture/matching.md
  - docs/architecture/testing.md
  - docs/architecture/frontend.md
context:
  - contract
  - architecture.matching
  - architecture.testing
  - architecture.frontend
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const fs=require('fs');const m=fs.readFileSync('docs/architecture/matching.md','utf8');for(const w of ['boxTitle','isBoxSet','resolveMatch','hasHebrewBoxWord'])if(!m.includes(w))throw new Error('matching.md '+w);const t=fs.readFileSync('docs/architecture/testing.md','utf8');if(!t.includes('recheck:links'))throw new Error('testing.md')"
---

# Goal

The architecture docs describe the merged S31 code briefly.

# Scope

1. `docs/architecture/matching.md`:
   - alternative titles in every Hardcover match;
   - box sets (`isBoxSet`, `boxCore`, the `boxTitle` option);
   - `resolveMatch`;
   - the browser box-set hint rule (`hasHebrewBoxWord`, `stripHebrewBoxWords`).
2. `docs/architecture/testing.md`: the operator steps for `npm run recheck:links`. Dry run, review every line, `--apply`, then `audit:authors`.
3. `docs/architecture/frontend.md`: one sentence saying genre shelves skip works that are on the reader's shelves.

The text must match the code. Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
