---
id: S36-T5
stage: 4
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S36-T2
  - S36-T3
  - S36-T4
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const m=require('fs').readFileSync('docs/architecture/matching.md','utf8');for(const w of ['sameBook','hardcoverHebrewEdition'])if(!m.includes(w))throw new Error('matching.md '+w)"
---

# Goal

`docs/architecture/matching.md` briefly describes S36:
- `link-edition` accepts an edition linked to a duplicate work of the same book (`sameBook`).
- The recommendation hint falls back to a Hebrew Hardcover edition (`hardcoverHebrewEdition`), with source and status `hardcover`.

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
