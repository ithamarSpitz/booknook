---
id: S31-T10
stage: 3
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S31-T5
  - S31-T9
allowed_paths:
  - public/js/recs.js
  - tests/web/nli-alt-hint.test.mjs
context:
  - contract
  - architecture.matching
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

When the step 2 title match misses with the hint title, the browser tries `hebrew_hint.alternate` once. Contract: "**NLI alternate hint (S31).**". Put no book-specific constants in the code.

# Scope

- In `localizeRecommendations` (`public/js/recs.js`), run this only when `match(hint.title, ...)` returned no book and `hint.alternate` is a non-empty string different from `hint.title`:
  - call `match(alternate, hint.author ?? "")` once, after the S31 box-word stripping, which applies to the alternate too;
  - verify a returned book with `verifyTitleMatch` exactly as for the main hint, and link it with `source` `nli`.
- If the alternate also misses, continue to the S30 omnibus step and the author path as before.
- Change nothing else.

# Tests

New `tests/web/nli-alt-hint.test.mjs`:
1. Card `Pet Sematary` by `Stephen King`, hint `{ source: "wikidata", title: "בית קברות לחיות", author: "סטיבן קינג", alternate: "בית כברות לחיות" }`. The `match` stub returns `null` for the title and 994102 `בית כברות לחיות` by `סטיבן קינג` for the alternate. `link-edition` is called once with 994102 and `source: "nli"`.
2. When the main title matches, `match` is called once (the alternate is not tried).
3. With no `alternate`, the behavior is unchanged.

Existing tests pass.

# Acceptance criteria

1. The behavior above; `npm run test:web` passes.
