---
id: S37-T6
stage: 5
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S37-T2
  - S37-T3
  - S37-T4
  - S37-T5
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const m=require('fs').readFileSync('docs/architecture/matching.md','utf8');for(const w of ['rematch:cached','wikidataHebrewAuthors','wikidataOriginals','initials'])if(!m.includes(w))throw new Error('matching.md '+w)"
---

# Goal

`docs/architecture/matching.md` briefly describes S37, in a short section next to "Series links":
- the job `npm run rematch:cached`, with its forward and reverse candidates, its confirmation by `resolveMatch`, and dry run versus `--apply`;
- the batched helpers `wikidataHebrewAuthors` and `wikidataOriginals`;
- `nameSoundScore` ignoring single-letter initials.

Change nothing else.
