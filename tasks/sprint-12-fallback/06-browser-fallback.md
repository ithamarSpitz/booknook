---
id: S12-T6
stage: 3
model_class: hard_worker
timeout_minutes: 50
review: true
allow_protected: false
depends_on:
  - S12-T2
  - S12-T3
  - S12-T4
allowed_paths:
  - public/js/recs.js
  - public/js/contract.js
  - tests/web/recs.test.mjs
  - tests/web/library.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

When the existing paths fail to find a Hebrew edition for an English-only card, the browser tries the catalog fallback. It links only on a single clear winner and never touches a card that already has a Hebrew edition.

# Scope

Contract: "Catalog fallback for English-only books", **Browser decision**. Reference: `tasks/sprint-12-fallback/reference/` (read `README.md` first). The browser part is `onSimania` in `nli-match.probe.ts` and the rule-G loop in `names.probe.ts`. The contract wins where they differ, and the probes are never imported.

1. `public/js/contract.js`: `FUNCTIONS.HEBREW_CANDIDATES = "hebrew-candidates"`.
2. `public/js/recs.js`:
   - Export `localizeFallback(rec, deps)`, implementing steps 1-5 and the bounds, with the `hebrew-fallback.js` helpers and `searchBooks`/`fetchSimaniaPayload` (injectable). It returns the decided Simania ID or null.
   - In `localizeRecommendations`, the queue becomes every `english_only` card. A card with neither hint nor Hebrew author skips the two existing paths.
   - After both existing paths miss, call `localizeFallback`. On a decision, call `link-edition` with `source: "nli_author"` and `onLinked` exactly as now.
   - `deps.isCurrent()` is checked between steps as now.
   - The genre shelf localizer in `library.js` already calls `localizeRecommendations`, so it gets the fallback without changes. Prove that with a test.

# Tests (`tests/web/recs.test.mjs`, plus one in `library.test.mjs`)

1. The title path succeeds: `hebrew-candidates` is never called.
2. Both paths miss, and a rule-A candidate is found on Simania with an agreeing author: `link-edition` is called with `nli_author` and that ID.
3. Rule A gives two different Simania IDs: no link.
4. Rule E candidate `כיבוי אורות` whose Simania author is `דיוויד קופ`, for "Aurora" by Kim Stanley Robinson: no link.
5. Rule G: three found editions with 3, 1 and 0 name hits give a link to the first; 2 and 2 gives no link; a single edition with 1 hit gives no link.
6. `link-edition` answers `409`: the card stays English-only and nothing throws.
7. A card with no hint and no Hebrew author still reaches the fallback.
8. Bounds: no more than 12 Simania searches and 6 detail reads per card.
9. Library: a genre book that misses the existing paths is linked by the fallback.

# Acceptance criteria

1. The behavior above; all tests pass.
