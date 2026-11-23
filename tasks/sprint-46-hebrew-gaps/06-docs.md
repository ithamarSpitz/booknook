---
id: S46-T6
stage: 6
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S46-T3
  - S46-T4
  - S46-T5
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('docs/architecture/matching.md','utf8');for(const k of ['author_books','provider-throttle'])if(!t.includes(k))throw new Error(k)"
---

# Goal

In `docs/architecture/matching.md`, add one short paragraph each on:
- the `author_books` source;
- the Hardcover and Wikimedia throttle in `scripts/lib/provider-throttle.ts`;
- the Hebrew-side guard and dictionary decisions, quoting the study numbers from `docs/reports/2026-11-23-*.md`.

Use the exact words `author_books` and `provider-throttle`.

Change nothing else.
