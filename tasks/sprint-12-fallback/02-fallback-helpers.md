---
id: S12-T2
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - public/js/names.js
  - public/js/hebrew-fallback.js
  - scripts/lib/names.ts
  - supabase/functions/_shared/names.ts
  - supabase/functions/_shared/fallback-match.ts
  - tests/functions/fallback-parity.test.ts
  - tests/web/hebrew-fallback.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
  - npm run test:functions
  - npm run check:functions
---

# Goal

The browser has the deterministic helpers the catalog fallback uses to decide whether a Simania book is the English book.

# Scope

Contract: "Catalog fallback for English-only books", **Shared helpers**. Reference: `tasks/sprint-12-fallback/reference/` (read `README.md` first). It holds the working probes; follow them for query strings and parsing. The contract wins where they differ, and the probes are never imported.

1. Move `nameSoundScore` (and the helpers it needs) from `scripts/lib/names.ts` to `supabase/functions/_shared/names.ts`. `scripts/lib/names.ts` keeps every current export by re-exporting from there, so `tests/functions/name-sound.test.ts`, `audit-catalog.ts` and `repair-links.ts` work unchanged, with identical behavior.
2. New `supabase/functions/_shared/fallback-match.ts`: `mainTitle` and `titleMatch`, using `normalize`/`similarity` from `_shared/utils.ts`.
3. Browser copies, as plain-JS ES modules with JSDoc types: `public/js/names.js` (`nameSoundScore`, the same algorithm) and `public/js/hebrew-fallback.js`. The latter has `mainTitle`, `titleMatch`, `authorAgrees`, `soundAgrees` and `nameHits` exactly as the contract defines them, using `normalize`/`similarity` from `public/js/simania.js`. Pure, no network.
4. New `tests/functions/fallback-parity.test.ts` imports both copies. Over at least 30 fixed inputs (Hebrew/Latin name pairs from `name-sound.test.ts`, and the title pairs below) it requires identical results from `nameSoundScore`, `mainTitle` and `titleMatch`.

# Tests (new `tests/web/hebrew-fallback.test.mjs`)

1. `mainTitle("הימנון ללייבוביץ [מהדורת 2003]")` is `"הימנון ללייבוביץ"`, and `mainTitle("לקסיקון : כשמילים יכולות להרוג")` is `"לקסיקון"`.
2. `titleMatch("To hate Adam Conor", "To Hate Adam Connor")` is true; `titleMatch("Aurora", "Blackout")` is false.
3. `authorAgrees("ו. א. שוואב", "ו.א. שוואב", "V. E. Schwab")` (same last word; the NLI candidate always carries its Hebrew author), `authorAgrees("מקס בארי", "מקס ברי", "Max Barry")` and `soundAgrees("וולטר מ. מילר הבן", "Walter M. Miller Jr.")` are true; `soundAgrees("דיוויד קופ", "Kim Stanley Robinson")` is false.
4. `nameHits(["Tricia","Ethan","Hale"], "<a Hebrew description mentioning טרישה and איתן>")` gives Tricia and Ethan.
5. The existing name-sound tests still pass.

# Acceptance criteria

1. The behavior above; all tests pass.
