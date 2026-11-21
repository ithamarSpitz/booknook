---
id: S41-T7
stage: 7
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S41-T6
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('docs/architecture/matching.md','utf8');for(const k of ['author-sound.ts','sound_checked_at','contradicted'])if(!t.includes(k))throw new Error(k)"
---

# Goal

In `docs/architecture/matching.md`, add a short paragraph under the `rematch:cached` section, describing:
- `_shared/author-sound.ts` (`sameAuthor`, `hebrewAuthorBySound`);
- names stored with source `sound` and `authors.sound_checked_at` (rechecked after 30 days);
- that only operator scripts run the lookup;
- the dictionary rule: both sides ≥ 0.67 and no `contradicted` word.

Use the exact words `author-sound.ts`, `sound_checked_at` and `contradicted`.

Change nothing else.
