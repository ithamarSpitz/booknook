---
id: S29-T4
stage: 4
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S29-T3
allowed_paths:
  - supabase/functions/_shared/simania.ts
  - docs/architecture/matching.md
context:
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "const fs=require('fs');if(fs.readFileSync('supabase/functions/_shared/simania.ts','utf8').includes('function matchHebrewBook'))throw new Error('simania.ts');if(fs.readFileSync('docs/architecture/matching.md','utf8').includes('remains for off-cloud use'))throw new Error('matching.md')"
---

# Goal

Remove dead code. `matchHebrewBook` in `supabase/functions/_shared/simania.ts` has no callers: on 2026-11-21, `grep` over `supabase`, `scripts`, `tests` and `public` finds only its definition. Recommendation step 2 runs in the browser with `public/js/simania.js`, and `scripts/lib/localize-chain.ts` imports from `public/js/simania.js`. Since S29, the server copy also no longer matches the browser rules.

# Scope

1. `supabase/functions/_shared/simania.ts`: delete `matchHebrewBook`, and any import or helper that only it used. Change nothing else.
2. `docs/architecture/matching.md`: delete the sentence "`matchHebrewBook` in `_shared/simania.ts` remains for off-cloud use." Change nothing else.

# Acceptance criteria

1. No remaining reference to the server `matchHebrewBook`; all three verification commands pass.
