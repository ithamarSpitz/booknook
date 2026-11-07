---
id: S13-T2
stage: 1
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - public/js/hebrew-fallback.js
  - public/js/recs.js
  - tests/web/hebrew-fallback.test.mjs
  - tests/web/recs.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

Rule G links a book only when its character names are distinctive for one Hebrew edition, so shared names and ordinary words can no longer make a wrong link.

# Scope

Contract: "Catalog fallback for English-only books", `nameHits` (tokenizer) and **Browser decision** step 4 (distinctive hits). Reference: `tasks/sprint-13-fallback-g/reference-rule-g.probe.ts` (`tokens`, `hitsOf` and the distinct-hits block). The contract wins where they differ, and the probe is never imported.

1. `public/js/hebrew-fallback.js` `nameHits`: the tokenizer change (geresh, gershayim, `’` and backtick inside tokens; at least 3 Hebrew letters).
2. `public/js/recs.js` `localizeFallback` rule G: compute each found edition's hits, keep only the distinctive ones (the name hits no other found edition), and decide by distinctive count: at least 2, strictly more than the runner-up. Everything else in `localizeFallback` is unchanged.

# Tests

1. `nameHits(["Tricia","Ethan"], "טרישה ואית׳ן, זוג צעיר")` gives both.
2. Pretty Girls shape: edition X hits Julia and Atlanta, edition Y hits Julia → no link.
3. Lathe shape: three editions each hit Orr and Haber → no link.
4. Never Lie shape: X hits Tricia and Ethan, Y and Z hit nothing → link X.
5. A single edition with 1 hit → no link. With 2 distinctive hits against a runner-up with 2 → no link.
6. Existing tests still pass.

# Acceptance criteria

1. The behavior above; all tests pass.
