---
id: S21-T6
stage: 5
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S21-T2
  - S21-T3
  - S21-T4
  - S21-T5
allowed_paths:
  - docs/architecture/frontend.md
  - docs/architecture/testing.md
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const r=f=>require('fs').readFileSync('docs/architecture/'+f,'utf8');for(const[f,w]of [['frontend.md','authorGuardRejects'],['testing.md','audit:authors'],['testing.md','--any-status']])if(!r(f).includes(w))throw new Error(f+' missing '+w)"
---

# Goal

The architecture docs describe S21 as merged.

# Scope

Read the merged code first: `public/js/names.js`, `public/js/hebrew-fallback.js`, `localizeRecommendations` in `public/js/recs.js`, `scripts/audit-authors.ts`, `scripts/refresh-all.ts` and `scripts/unlink-fallback.ts`.

1. `frontend.md`, where localization is described: the author guard (`authorGuardRejects`) runs before every `link-edition` call.
2. `testing.md`, in the operator routine:
   - `audit:authors` (read-only review of existing links);
   - `unlink:fallback --apply --simania <id> --any-status`, only with the operator's OK;
   - `refresh:all` failure lines.

# Protected-path permission (operator decision, 2026-11-19)

`docs/architecture/**` is protected. Permitted: the additions above to those two files. Not permitted: anything else. The reviewer must fail the task otherwise.

# Acceptance criteria

1. The docs match the merged code; `check:contract` and the verification command pass.
