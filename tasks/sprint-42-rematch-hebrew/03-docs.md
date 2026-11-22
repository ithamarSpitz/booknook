---
id: S42-T3
stage: 3
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S42-T2
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "if(!require('fs').readFileSync('docs/architecture/matching.md','utf8').includes('--hebrew'))throw new Error('matching.md')"
---

# Goal

Add one or two sentences to the `rematch:cached` section of `docs/architecture/matching.md`, describing `--hebrew`:
- a dry run over Hebrew editions without a work, using the current resolver and the author agreement;
- its proposals are applied with `--from <file> --apply`.

Use the exact word `--hebrew`.

Change nothing else.
