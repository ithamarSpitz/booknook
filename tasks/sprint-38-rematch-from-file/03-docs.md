---
id: S38-T3
stage: 3
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S38-T2
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const m=require('fs').readFileSync('docs/architecture/matching.md','utf8');if(!m.includes('--from'))throw new Error('matching.md --from')"
---

# Goal

In `docs/architecture/matching.md`, the S37 `rematch:cached` section briefly adds:
- The dry run's proposal lines include `book_id`, and `--from <file> --apply` links them with one Hardcover request per 50 proposals, without searching again.
- A failed author batch at startup is retried twice, 30 seconds apart.

Change nothing else.
