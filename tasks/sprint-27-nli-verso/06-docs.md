---
id: S27-T6
stage: 4
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S27-T2
  - S27-T3
  - S27-T5
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
    node -e "const fs=require('fs');if(!fs.readFileSync('docs/architecture/matching.md','utf8').includes('Title page verso'))throw new Error('matching.md');if(!fs.readFileSync('docs/architecture/testing.md','utf8').includes('--min-hardcover'))throw new Error('testing.md')"
---

# Goal

The docs describe the merged S27 changes, briefly:
- `docs/architecture/matching.md`: in the NLI step, the title page verso candidate (only when 041 `h` is not `heb`) and the `versoAuthor` hint;
- `docs/architecture/testing.md`: the Hardcover budget check before `refresh:all` and `verify:fallback`, the flags `--min-hardcover` and `--force-hardcover`, and exit code `4`. Also add the advice to run before/after compares one after the other, not in parallel, because they share one Hardcover key with prod.

Change nothing else.

# Acceptance criteria

1. The text matches the code; both verification commands pass.
