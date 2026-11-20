---
id: S28-T3
stage: 3
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S28-T2
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "if(!require('fs').readFileSync('docs/architecture/matching.md','utf8').includes('245'))throw new Error('matching.md')"
---

# Goal

`docs/architecture/matching.md` describes the merged S28 change briefly. In the NLI step, the Hebrew title of a record is matched against the full 245 title, against 245 `a` alone, and against Hebrew 246 titles, and the best of the three counts.

Change nothing else.

# Acceptance criteria

1. The text matches the code; both verification commands pass.
