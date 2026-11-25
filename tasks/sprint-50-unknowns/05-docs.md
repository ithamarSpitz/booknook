---
id: S50-T5
stage: 4
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S50-T2
  - S50-T4
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('docs/architecture/matching.md','utf8');for(const k of ['missed_rate_strict_high','duplicate_of','rechecked','catalog_checked'])if(!t.includes(k))throw new Error(k)"
---

# Goal

In `docs/architecture/matching.md`, add short paragraphs on:
- the end-of-run recheck (`rechecked`);
- `duplicate_of` and `duplicate_work`;
- the evidence classes, with `catalog_checked` and `missed_rate_strict_high`;
- the rematch always running the measurement's check.

Use those exact words. Change nothing else.
