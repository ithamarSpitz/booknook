---
id: S43-T6
stage: 4
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S43-T2
  - S43-T3
  - S43-T4
  - S43-T5
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('docs/architecture/matching.md','utf8');for(const k of ['nli_english_mismatch','measure:links','failures'])if(!t.includes(k))throw new Error(k)"
---

# Goal

In `docs/architecture/matching.md`, add one short paragraph for each of these, using the exact words `failures`, `nli_english_mismatch` and `measure:links`:
- the `failures` detail on `provider_failure` skip lines;
- the `nli_english_mismatch` guard;
- `npm run measure:links` and its `--wrong <n>`.

Change nothing else.
