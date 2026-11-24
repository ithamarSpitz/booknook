---
id: S47-T2
stage: 2
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S47-T1
allowed_paths:
  - docs/architecture/matching.md
context:
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "if(!require('fs').readFileSync('docs/architecture/matching.md','utf8').includes('rematch-measure.yml'))throw new Error('matching.md')"
---

# Goal

In `docs/architecture/matching.md`, add a short paragraph on `.github/workflows/rematch-measure.yml`. It should cover:
- it is manual (`gh workflow run rematch-measure.yml`) and read-only, and never applies;
- the jobs run in order: hebrew, English shards one at a time, measure;
- results are artifacts kept 14 days;
- the repo secrets it needs: `TORIMITOR_DB_PASSWORD`, `HARDCOVER_API_KEY`, `NLI_API_KEY`, and `TORIMITOR_DB_HOST` if the pooler is used;
- applying is still done locally with `--from <file> --apply`, after review.

Use the exact name `rematch-measure.yml`.

Change nothing else.
