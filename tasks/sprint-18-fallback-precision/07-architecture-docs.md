---
id: S18-T7
stage: 4
model_class: worker
timeout_minutes: 20
review: true
allow_protected: true
depends_on:
  - S18-T2
  - S18-T3
  - S18-T4
  - S18-T5
  - S18-T6
allowed_paths:
  - docs/architecture/functions.md
  - docs/architecture/frontend.md
  - docs/architecture/testing.md
context:
  - contract
  - architecture.functions
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const r=f=>require('fs').readFileSync('docs/architecture/'+f,'utf8');for(const[f,w]of [['functions.md','original_year'],['functions.md','startRecord'],['frontend.md','original_year'],['testing.md','--replay-linked'],['testing.md','--compare']])if(!r(f).includes(w))throw new Error(f+' missing '+w)"
---

# Goal

The architecture docs describe the S18 fallback changes and the no-regression tools as they were built.

# Scope

Describe only what the merged code does. Read the code: `supabase/functions/_shared/hebrew-candidates.ts`, `supabase/functions/hebrew-candidates/index.ts`, `localizeFallback` in `public/js/recs.js`, and `scripts/verify-fallback.ts` with `scripts/lib/fallback-compare.ts`. Where code and contract differ, write what the code does and say so in your final message. Keep each addition short, in the file's style.

1. `functions.md`, `## hebrew-candidates`:
   - NLI creator paging (`startRecord`, up to 300 records, at most 4 NLI requests);
   - `original_year` in the response;
   - `english_names` words of length ≥ 5.
2. `frontend.md`: one sentence where the fallback or the recommendations localization is described: the year guard for rules E, F and G uses `original_year`.
3. `testing.md`: the operator no-regression routine:
   - `verify:fallback` with `--population` and `--replay-linked`, before and after a fallback change;
   - `--compare` with `--keep`, and its exit code;
   - the 429 retry;
   - no `refresh:all -- --apply` until changes are reviewed.

# Protected-path permission (operator decision, 2026-11-19)

`docs/architecture/**` is protected. Permitted: the additions in Scope 1-3 to those three files. Not permitted: any other file, or rewording unrelated text. The reviewer must fail the task otherwise.

# Acceptance criteria

1. The docs match the merged code; `check:contract` and the verification command pass.
