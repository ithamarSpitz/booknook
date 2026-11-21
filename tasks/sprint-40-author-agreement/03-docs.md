---
id: S40-T3
stage: 3
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S40-T2
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "if(!require('fs').readFileSync('docs/architecture/matching.md','utf8').includes('author agreement'))throw new Error('matching.md')"
---

# Goal

Add one sentence to the `rematch:cached` section of `docs/architecture/matching.md`, using the words "author agreement". A proposal needs the Hebrew edition's author to agree with the work's authors (`authorAgreesWithWork`), and `--from` checks it again.

Change nothing else.
