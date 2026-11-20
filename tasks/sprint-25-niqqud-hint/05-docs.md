---
id: S25-T5
stage: 3
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S25-T2
  - S25-T3
  - S25-T4
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('docs/architecture/matching.md','utf8');for(const w of ['stripHebrewPoints','0.8'])if(!t.includes(w))throw new Error('matching.md missing '+w)"
---

# Goal

`docs/architecture/matching.md` describes the merged S25 changes, briefly:
- `stripHebrewPoints` in `normalize` and in `nameSoundScore`, in the browser and on the server;
- the third title-match verification rule in `verifyTitleMatch`: the author sounds like the English author, `>= 0.8`.

Change nothing else.

# Acceptance criteria

1. The text matches the code; both verification commands pass.
