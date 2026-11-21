---
id: S33-T5
stage: 4
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S33-T2
  - S33-T3
  - S33-T4
allowed_paths:
  - docs/architecture/matching.md
  - docs/architecture/testing.md
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const fs=require('fs');const m=fs.readFileSync('docs/architecture/matching.md','utf8');const t=fs.readFileSync('docs/architecture/testing.md','utf8');for(const w of ['prefix-only','whitespace'])if(!m.toLowerCase().includes(w))throw new Error('matching.md '+w);if(!t.includes('retried'))throw new Error('testing.md retried')"
---

# Goal

The architecture docs briefly describe the S33 rules:
- `docs/architecture/matching.md`:
  - `matchTitle` collapses inner whitespace;
  - prefix-only Wikidata matches are weak, so the NLI step also runs, and a full NLI match wins.
- `docs/architecture/testing.md`: the `recheck:links` steps mention the one retry of provider failures and the `retried` count in the summary.

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
