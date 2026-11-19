---
id: S23-T4
stage: 3
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S23-T2
  - S23-T3
allowed_paths:
  - docs/architecture/matching.md
context:
  - contract
  - architecture.matching
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('docs/architecture/matching.md','utf8');if(!t.includes('authorGuardRejects'))throw new Error('matching.md missing authorGuardRejects')"
---

# Goal

`docs/architecture/matching.md` describes the merged S23 resolver guard.

# Scope

Read `supabase/functions/_shared/catalog.ts` (`ensureResolved`) and `_shared/fallback-match.ts` first. Then, where `matching.md` describes resolution, add one short paragraph:
- each wikidata, nli or fuzzy match is checked with `authorGuardRejects`;
- a rejected match falls through to the next path and is not a provider failure.

If `matching.md` does not exist, stop and fail the task with that reason.

# Protected-path permission (operator decision, 2026-11-20)

`docs/architecture/**` is protected. Permitted: this paragraph only. The reviewer must fail the task otherwise.

# Acceptance criteria

1. The docs match the merged code; `check:contract` and the verification command pass.
