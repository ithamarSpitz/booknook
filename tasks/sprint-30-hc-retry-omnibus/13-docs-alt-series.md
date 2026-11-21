---
id: S30-T13
stage: 5
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S30-T8
  - S30-T10
  - S30-T12
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
    node -e "const fs=require('fs');const m=fs.readFileSync('docs/architecture/matching.md','utf8');for(const w of ['alternative_titles','series:links'])if(!m.includes(w))throw new Error('matching.md '+w);const t=fs.readFileSync('docs/architecture/testing.md','utf8');if(!t.includes('series:links'))throw new Error('testing.md')"
---

# Goal

The architecture docs describe the last S30 additions briefly.

# Scope

1. `docs/architecture/matching.md`:
   - the retry's use of search `alternative_titles`;
   - `series:links`: anchors, the accepted Hardcover series, the book pick, and the `series` status.
2. `docs/architecture/testing.md`: the operator steps for `npm run series:links`. Dry run, review every proposal, `--apply`, then list the links by status `series`.

The text must match the code. Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
