---
id: S30-T8
stage: 4
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S30-T2
  - S30-T3
  - S30-T4
  - S30-T5
  - S30-T6
  - S30-T7
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
    node -e "const fs=require('fs');const m=fs.readFileSync('docs/architecture/matching.md','utf8');for(const w of ['retryWithAuthor','soundAuthor','matchOmnibus','omnibus'])if(!m.includes(w))throw new Error('matching.md '+w);const t=fs.readFileSync('docs/architecture/testing.md','utf8');if(!t.includes('report:omnibus'))throw new Error('testing.md')"
---

# Goal

The architecture docs describe the merged S30 code briefly.

# Scope

1. `docs/architecture/matching.md`:
   - In the resolver section:
     - the `findHardcoverBook` options `retryWithAuthor` (title + author search, `:` prefix Dice) and `soundAuthor` (`nameSoundScore >= 0.6`), and where `ensureResolved` passes them;
     - the series-prefix NLI retry.
   - In the localization section: `matchOmnibus`, its guards (title match missed, at least 2 ` | ` parts, part similarity `>= 0.9`, a single result, author agreement) and the `omnibus` status.
2. `docs/architecture/testing.md`:
   - next to `requeue:not-found`: that `--simania <id>` also selects unreferenced editions;
   - `npm run report:omnibus` (read-only, one line per omnibus link, reviewed after every refresh).

The text must match the code. Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
