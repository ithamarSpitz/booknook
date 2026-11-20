---
id: S26-T5
stage: 3
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S26-T2
  - S26-T3
  - S26-T4
allowed_paths:
  - docs/architecture/testing.md
  - docs/architecture/matching.md
context:
  - contract
  - architecture.testing
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const fs=require('fs');if(!fs.readFileSync('docs/architecture/testing.md','utf8').includes('requeue:not-found'))throw new Error('testing.md');if(!fs.readFileSync('docs/architecture/matching.md','utf8').includes('matchTitle'))throw new Error('matching.md')"
---

# Goal

The docs describe the merged S26 changes, briefly:
- `docs/architecture/matching.md`: the `matchTitle` edition-label rule;
- `docs/architecture/testing.md`: the operator step `requeue:not-found` (dry run, then `--apply`, then `refresh:all -- --apply`), and that `refresh:all` step 4 also covers `pending` editions.

Change nothing else.

# Acceptance criteria

1. The text matches the code; both verification commands pass.
