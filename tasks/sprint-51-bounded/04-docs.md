---
id: S51-T4
stage: 4
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S51-T3
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('docs/architecture/matching.md','utf8');for(const k of ['--work-timeout','host queue timeout','Retry-After'])if(!t.includes(k))throw new Error(k)"
---

# Goal

In `docs/architecture/matching.md`, add one short paragraph each on:
- the bounded waits (the 60 s `Retry-After` cap and `host queue timeout`);
- `--work-timeout` and the `deadline` failure;
- the sound lookup stopping at its first failed search.

Use those exact words. Change nothing else.
