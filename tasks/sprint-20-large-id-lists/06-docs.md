---
id: S20-T6
stage: 4
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S20-T2
  - S20-T3
  - S20-T4
  - S20-T5
allowed_paths:
  - docs/architecture/functions.md
  - docs/architecture/frontend.md
context:
  - contract
  - architecture.functions
  - architecture.frontend
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const r=f=>require('fs').readFileSync('docs/architecture/'+f,'utf8');for(const[f,w]of [['functions.md','selectInChunks'],['frontend.md','failed()']])if(!r(f).includes(w))throw new Error(f+' missing '+w)"
---

# Goal

The architecture docs describe the S20 changes as merged.

# Scope

Read the merged code first: `supabase/functions/_shared/chunked.ts`, its callers, and `public/js/recs-refresh.js`. Write what the code does.

1. `functions.md`, `## Shared code`: `chunked.ts` / `selectInChunks` (at most 100 values per `in` request, 4 at a time), and that all `in` lookups use it.
2. `frontend.md`: where the background regeneration (`recs-refresh.js`) is described, add `failed()` and the status line on `#recs` and `#genres`.

# Protected-path permission (operator decision, 2026-11-19)

`docs/architecture/**` is protected. Permitted: the additions in Scope 1-2 to those two files. Not permitted: anything else. The reviewer must fail the task otherwise.

# Acceptance criteria

1. The docs match the merged code; `check:contract` and the verification command pass.
