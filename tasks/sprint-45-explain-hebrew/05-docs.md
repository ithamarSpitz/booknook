---
id: S45-T5
stage: 6
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S45-T3
  - S45-T4
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "if(!require('fs').readFileSync('docs/architecture/matching.md','utf8').includes('--explain'))throw new Error('matching.md')"
---

# Goal

In the `rematch:cached` section of `docs/architecture/matching.md`, add one or two sentences:
- on `--hebrew --explain`;
- and, if it was built, on the `hebrew_dictionary` step, quoting the study numbers from `docs/reports/2026-11-22-hebrew-dictionary-study.md`.

Use the exact word `--explain`.

Change nothing else.
