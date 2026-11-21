---
id: S34-T3
stage: 3
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S34-T2
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const m=require('fs').readFileSync('docs/architecture/matching.md','utf8');for(const w of ['search documents','hardcoverBooks'])if(!m.includes(w))throw new Error('matching.md '+w)"
---

# Goal

`docs/architecture/matching.md` briefly describes S34:
- Hardcover matching ranks candidates built from the search documents. It falls back to the details request only when a document is missing.
- `ensureResolved` fetches one book's details with `hardcoverBooks` before writing a new work.

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
