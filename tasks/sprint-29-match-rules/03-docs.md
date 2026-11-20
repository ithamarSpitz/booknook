---
id: S29-T3
stage: 3
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S29-T2
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('docs/architecture/matching.md','utf8');if(!t.includes('match-replay'))throw new Error('matching.md')"
---

# Goal

`docs/architecture/matching.md` describes the merged S29 change briefly:
- in recommendation step 2, the word-subset boost (it needs author agreement) and the tie-break order;
- the second, title-only search for one-word hints;
- the replay test `tests/web/match-replay.test.mjs`, which guards the picks that equal prod links.

Change nothing else.

# Acceptance criteria

1. The text matches the code; both verification commands pass.
