---
id: S19-T4
stage: 3
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S19-T2
  - S19-T3
allowed_paths:
  - docs/architecture/frontend.md
  - docs/architecture/testing.md
  - docs/architecture/functions.md
context:
  - contract
  - architecture.frontend
  - architecture.testing
  - architecture.functions
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const r=f=>require('fs').readFileSync('docs/architecture/'+f,'utf8');for(const[f,w]of [['frontend.md','year 0'],['testing.md','original_year'],['functions.md','originalYearOf']])if(!r(f).includes(w))throw new Error(f+' missing '+w)"
---

# Goal

The architecture docs match the S19 fixes as merged.

# Scope

Read the merged code first: `localizeFallback` in `public/js/recs.js`, `originalYearOf` in `supabase/functions/_shared/hebrew-candidates.ts`, and `scripts/verify-fallback.ts`. Write what the code does.

1. `frontend.md`: in the sentence about the year guard, add that year 0 (unknown on Simania) never triggers it.
2. `functions.md`, `## hebrew-candidates`: `original_year` comes from the shared `originalYearOf` (a positive integer, otherwise null).
3. `testing.md`, in the no-regression routine: the review passes `original_year` to `localizeFallback` the way the browser gets it, so the guard is checked; `--compare` ignores non-JSON lines.

# Protected-path permission (operator decision, 2026-11-19)

`docs/architecture/**` is protected. Permitted: the additions in Scope 1-3 to those three files. Not permitted: anything else. The reviewer must fail the task otherwise.

# Acceptance criteria

1. The docs match the merged code; `check:contract` and the verification command pass.
