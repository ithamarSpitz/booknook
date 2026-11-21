---
id: S36-T4
stage: 3
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S36-T2
  - S36-T3
allowed_paths:
  - public/js/recs.js
  - supabase/functions/link-edition/index.ts
  - tests/web/hc-hint-source.test.mjs
  - tests/functions/link-edition-duplicates.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - npm run test:web
---

# Goal

A `hardcover` hint links with source and status `hardcover`. Contract: "**Hardcover Hebrew edition hint (S36).**" (browser and link part).

# Scope

1. In `public/js/recs.js`, every place that maps `rec.hebrew_hint.source` to a link source or `resolve_status` maps it like this: `nli` → `nli`, `hardcover` → `hardcover`, anything else → `wikidata`.
   - Today those places read `rec.hebrew_hint?.source === "nli" ? "nli" : "wikidata"`, near the `verifyTitleMatch` code and the `source:` mapping around line 197.
   - Matching itself is unchanged: the hint title still goes through `matchHebrewBook` and `verifyTitleMatch`.
2. In `supabase/functions/link-edition/index.ts`, add `hardcover` to the accepted `source` values and to the 400 error message.

# Tests

1. New `tests/web/hc-hint-source.test.mjs`, following the existing web tests' style. `verifyTitleMatch` with `rec.hebrew_hint.source = "hardcover"` and an author that matches by sound returns `resolve_status: "hardcover"`. With `source: "nli"`, it is still `nli`.
2. In `tests/functions/link-edition-duplicates.test.ts`, add one case: `source: "hardcover"` is accepted, not 400.

Existing tests pass.

# Acceptance criteria

1. The behavior above; all three verification commands pass.
