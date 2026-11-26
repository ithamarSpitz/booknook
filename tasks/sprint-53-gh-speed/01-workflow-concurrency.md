---
id: S53-T1
stage: 1
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on: []
allowed_paths:
  - .github/workflows/rematch-measure.yml
context: []
environment: null
verification:
  - npm run check:functions
  - >-
    node -e "const t=require('fs').readFileSync('.github/workflows/rematch-measure.yml','utf8');if(!/max-parallel:\s*2\b/.test(t))throw new Error('max-parallel: 2');if(!/rematch-cached\.ts[^\n]*--concurrency 4/.test(t))throw new Error('English shard must pass --concurrency 4');if((t.match(/check:run-health/g)||[]).length<3)throw new Error('keep the health checks');if(/--apply/.test(t))throw new Error('never apply');if(!/workflow_dispatch/.test(t)||/schedule:/.test(t))throw new Error('manual trigger only')"
---

# Goal

Speed up the English shards in `.github/workflows/rematch-measure.yml` without raising per-host load beyond what has been measured as safe. Spend few tokens.

1. In the English shard job's `strategy`, change `max-parallel: 1` to `max-parallel: 2`.
2. In the step `Rematch English shard`, add `--concurrency 4` to the `scripts/rematch-cached.ts` command, keeping all its other flags.

   The S49 limiter keeps one request in flight per provider host within a process. Measured on 2026-11-25: 15 works took 317 s serially and 119 s at `--concurrency 4`, with 0 provider failures.

Change nothing else. Keep the health checks, the triggers, `if: always()` on uploads, and the exit-4 handling.

# Acceptance criteria

1. Both verification commands pass.
