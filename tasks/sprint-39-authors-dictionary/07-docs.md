---
id: S39-T7
stage: 6
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S39-T2
  - S39-T3
  - S39-T4
  - S39-T5
  - S39-T6
allowed_paths:
  - docs/architecture/matching.md
  - docs/architecture/data-model.md
context:
  - contract
  - architecture.matching
  - architecture.data_model
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const fs=require('fs');const m=fs.readFileSync('docs/architecture/matching.md','utf8');for(const w of ['author_names','recordPair','authors:seed','pickByDictionary'])if(!m.includes(w))throw new Error('matching.md '+w);if(!fs.readFileSync('docs/architecture/data-model.md','utf8').includes('author_names'))throw new Error('data-model.md')"
---

# Goal

The docs briefly describe S39:
- `docs/architecture/data-model.md`: the `authors` and `author_names` tables and the `dictionary` status.
- `docs/architecture/matching.md`:
  - author lookups go through the table (`hebrewNames`, `englishNames`, `recordPair`, `authors:seed`);
  - failures are not stored;
  - the dictionary is the last step of `rematch:cached` (`pickByDictionary`).

Change nothing else.
