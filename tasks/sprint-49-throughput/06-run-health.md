---
id: S49-T6
stage: 2
model_class: worker
timeout_minutes: 40
review: true
allow_protected: true
depends_on:
  - S49-T1
allowed_paths:
  - scripts/check-run-health.ts
  - package.json
  - .github/workflows/rematch-measure.yml
  - tests/functions/check-run-health.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "if(!require('./package.json').scripts['check:run-health'])throw new Error('check:run-health');const t=require('fs').readFileSync('.github/workflows/rematch-measure.yml','utf8');if((t.match(/check-run-health|check:run-health/g)||[]).length<3)throw new Error('run the health check after hebrew, each english shard and measure');if(/--apply/.test(t))throw new Error('never apply')"
---

# Goal

Implement **Run health (S49)**. Spend few tokens.

GitHub run 45486346122 on 2026-11-24 was all green but useless:
- all 1,767 English works were `provider_failure`, with Simania answering the runners with HTTP 403;
- 204 of 400 sampled measure works failed.

A green job must mean the output can be trusted.

1. Add `scripts/check-run-health.ts` (read-only, no network) and `npm run check:run-health -- <file>`. It reads one output file and exits 1, printing a one-line reason, when any of these holds:
   - **`rematch:cached`** (English or `--hebrew`): the last JSON line has no `works` summary, **or** `skipped.provider_failure` is more than half of `works`, **or** any `failures[].error` mentions HTTP 403 from Simania (`Book catalog returned HTTP 403` or `(403)`).
   - **`measure:links`**: `failed_in_sample` is more than half of `sampled`, **or** `hebrew.provider_failure` is more than half of `hebrew.unlinked_editions`.

   Otherwise it prints `{"healthy":true, ...counts}` and exits 0.
2. Run it in `.github/workflows/rematch-measure.yml` right after each output is written: the hebrew job, each English shard and the measure job. The job fails when it fails, and the artifact is still uploaded (`if: always()` on the upload step). Keep exit 4 (budget floor) from `rematch:cached` as not a failure, as today.

# Acceptance criteria

1. `tests/functions/check-run-health.test.ts` covers:
   - a healthy English file;
   - a missing summary;
   - 442/442 provider failures (the 2026-11-24 shard);
   - one Simania 403;
   - a measure file with 204/400 failed;
   - a healthy measure file;
   - a Hebrew file with 2/136 failures (healthy).
2. All verification commands pass.
