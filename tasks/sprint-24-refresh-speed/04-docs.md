---
id: S24-T4
stage: 4
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S24-T2
  - S24-T3
allowed_paths:
  - docs/architecture/testing.md
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('docs/architecture/testing.md','utf8');for(const w of ['--concurrency','--skip-cache'])if(!t.includes(w))throw new Error('testing.md missing '+w)"
---

# Goal

`docs/architecture/testing.md` describes the merged S24 `refresh:all` options, next to the existing `refresh:all -- --apply` bullet.

# Scope

Describe what the code does now, briefly:
- `--concurrency N`: default 4, 1 to 8;
- the one Simania throttle for the whole run;
- `--skip-cache <file>`: what is skipped and for how long, and that a code change clears it;
- the `skipped` total.

Say that the operator keeps the cache file outside the repo. Change nothing else.

# Acceptance criteria

1. The text matches `scripts/refresh-all.ts`; both verification commands pass.
