---
id: S14-T1
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - public/js/recs.js
  - tests/web/recs.test.mjs
  - scripts/verify-fallback.ts
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
  - npm run check:functions
---

# Goal

Rule G no longer links a book to another book of the same series, so Regeneration can't be linked to The Ghost Road.

# Scope

Contract: "Catalog fallback for English-only books", **Browser decision** step 4 (the winner's rivals must have no hits at all) and the must-not-link list (Regeneration → 844).

1. `public/js/recs.js` `localizeFallback` rule G: keep the current distinctive-hits rule, and add one condition: if any other found edition has at least one hit (shared or distinctive), the result is no link. Everything else is unchanged.
2. `scripts/verify-fallback.ts`: add the case "Regeneration (Pat Barker) must not decide 844", alongside the other must-not-link cases. Change nothing else.

# Tests (`tests/web/recs.test.mjs`)

1. Regeneration shape: X has hits Siegfried, Kemp and Sunday; Y has Siegfried and Sassoon; Z has Siegfried, Sassoon and Peter → no link.
2. The Sea shape: X has Max, Graces and Today; Y and Z have nothing → link X.
3. Never Lie shape still links, and the Pretty Girls and Lathe shapes still don't.
4. Existing tests still pass.

# Acceptance criteria

1. The behavior above; all tests pass.
