---
id: S32-T4
stage: 3
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S32-T2
  - S32-T3
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const m=require('fs').readFileSync('docs/architecture/matching.md','utf8');for(const w of ['Q1667921','Companion'])if(!m.includes(w))throw new Error('matching.md '+w)"
---

# Goal

`docs/architecture/matching.md` briefly describes the S32 guards:
- series entities rejected by the Wikidata bridge;
- box-set and companion books dropped before Hardcover ranking.

The text must match the code. Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
