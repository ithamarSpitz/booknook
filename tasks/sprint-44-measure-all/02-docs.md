---
id: S44-T2
stage: 2
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S44-T1
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "if(!require('fs').readFileSync('docs/architecture/matching.md','utf8').includes('--sample'))throw new Error('matching.md')"
---

# Goal

In the `measure:links` paragraph of `docs/architecture/matching.md`, add one sentence on `--all --sample <n>`: it measures all cached works by sampling the unlinked ones, and estimates the missed rate over all works. Use the exact word `--sample`.

Change nothing else.
