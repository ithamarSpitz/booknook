---
id: S9-T2
stage: 1
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - scripts/lib/names.ts
  - tests/functions/name-sound.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

A deterministic score that says whether a Hebrew-script author name and a Latin-script author name are the same person.

# Scope

Contract: "Operator scripts: catalog audit and link repair", **Name sound score**. New `scripts/lib/names.ts` exporting `nameSoundScore(hebrewName: string, latinNames: string[]): number` exactly as specified (letter maps, sound classes, collapse repeats, bigram Dice, maximum over `latinNames`; empty input gives 0). Pure: no network, no database. Also export the two skeleton helpers (`hebrewSkeleton`, `latinSkeleton`) for tests.

# Tests (new `tests/functions/name-sound.test.ts`)

These pairs come from production (measured 2026-11-05) and must hold:
1. Same person, score at least 0.5: `סטיבן קינג` / `Stephen King`, `פרידה מקפדן` / `Freida McFadden`, `ססיליה אדוארד` / `Cecilia Edward`, `רופי תורפ` / `Rufi Thorpe`, `אבי חימנז` / `Abby Jimenez`.
2. Different people, score below 0.5: `אבי חימנז` against each of `Karin N. Mango`, `Laura Van Wormer`, `Judy Astley`, `Melody Carlson`, `Jenna Rutland`, `Sue Moorcroft` (the other authors of books titled "Just for the Summer").
3. Maximum over several names: `רופי תורפ` against `["Someone Else", "Rufi Thorpe"]` equals the single-name score.
4. Empty Hebrew name or empty list gives 0. Deterministic (same input, same output).

If a pair in 1 or 2 cannot hold with the contract's exact rules, do not change the thresholds: report it in your final message and keep the test that shows the actual value.

# Acceptance criteria

1. The behavior above; all tests pass.
