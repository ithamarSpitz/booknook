---
id: S49-T7
stage: 6
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S49-T5
  - S49-T6
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('docs/architecture/matching.md','utf8');for(const k of ['--concurrency','--cache-dir','check:run-health','setProviderRetry'])if(!t.includes(k))throw new Error(k)"
---

# Goal

In the `rematch:cached` / `measure:links` part of `docs/architecture/matching.md`, add one short paragraph each on:
- the provider retry (`setProviderRetry`, scripts only);
- the response cache (`--cache-dir`, 7 days, idempotent providers only);
- `--concurrency` (1–4, one request per host, ordered output);
- `check:run-health` and its use in `rematch-measure.yml`.

Use those exact words. Change nothing else.
