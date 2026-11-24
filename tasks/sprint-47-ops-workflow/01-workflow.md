---
id: S47-T1
stage: 1
model_class: worker
timeout_minutes: 40
review: true
allow_protected: true
depends_on: []
allowed_paths:
  - .github/workflows/rematch-measure.yml
  - scripts/lib/prod-db.ts
  - tests/functions/prod-db.test.ts
context:
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "const t=require('fs').readFileSync('.github/workflows/rematch-measure.yml','utf8');for(const k of ['workflow_dispatch','timeout-minutes','upload-artifact','TORIMITOR_DB_PASSWORD','HARDCOVER_API_KEY','NLI_API_KEY','BOOKNOOK_ENV_FILE','--offset','--limit','--hebrew --explain','measure-links.ts'])if(!t.includes(k))throw new Error('missing '+k);if(/--apply/.test(t))throw new Error('the workflow must never apply');if(/schedule:/.test(t))throw new Error('manual trigger only');if(/cat .*env|echo .*secrets/.test(t))throw new Error('never print secrets')"
---

# Goal

Add `.github/workflows/rematch-measure.yml`, so the long read-only runs happen on GitHub's servers instead of the user's PC. The repo is public, so standard runners are free. Spend few tokens.

- **Trigger:** `workflow_dispatch` only, with no schedule. Inputs:
  - `english_shards`: number, default 4;
  - `sample`: number, default 400.
- **Setup (every job):** check out the repo, set up Deno at the version the repo uses, then write the env file from secrets:

  ```bash
  printf 'TORIMITOR_DB_PASSWORD=%s\nHARDCOVER_API_KEY=%s\nNLI_API_KEY=%s\n' "$DB" "$HC" "$NLI" > "$RUNNER_TEMP/booknook.env"
  ```

  Here `DB`, `HC` and `NLI` come from `secrets.TORIMITOR_DB_PASSWORD`, `secrets.HARDCOVER_API_KEY` and `secrets.NLI_API_KEY` via `env:`. Set `BOOKNOOK_ENV_FILE=$RUNNER_TEMP/booknook.env`. Never `cat` or `echo` it.
- **Jobs, strictly one after another,** using `needs:` (parallel jobs bring back Hardcover 429s). Every job gets `timeout-minutes: 340`.
  1. `hebrew`: `deno run … scripts/rematch-cached.ts --hebrew --explain --min-hardcover 1500`, writing `hebrew.jsonl`.
  2. `english`: a matrix over the shards with `max-parallel: 1`. Each shard first counts the works without a linked Hebrew edition, using the same query as `loadWorks`, through a small `node`/`deno` step, then runs `rematch-cached.ts --offset <i*size> --limit <size> --min-hardcover 1500`, writing `english-<i>.jsonl`. Exit code 4 (budget floor) is not a failure.
  3. `measure`: `scripts/measure-links.ts --all --sample <sample> --hebrew`, writing `measure.json`.
- **Output:** each job uploads its file with `actions/upload-artifact`, `retention-days: 14`.
- **Never `--apply`.**
- **Network:** GitHub runners have no IPv6. If `scripts/lib/prod-db.ts` connects to Supabase's direct host, which is IPv6-only, add an optional `TORIMITOR_DB_HOST` override from the env file, so the workflow can use the Supabase pooler host. Keep today's default for local runs. Test the override in `tests/functions/prod-db.test.ts` without connecting to anything.

# Acceptance criteria

1. The workflow file meets every point above.
2. All verification commands pass.
