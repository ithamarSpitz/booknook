---
id: S10-T1
stage: 1
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - scripts/lib/simania-page.ts
  - tests/functions/simania-page.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Read the author's Latin name and a clean title from the original-title line on a Simania book page.

# Scope

Contract: "Operator scripts: catalog audit and link repair", **Original title from the Simania page** (both paragraphs). In `scripts/lib/simania-page.ts`:

1. Export `pageOriginal(html): { title: string; author: string | null } | null` built from the same source value `pageOriginalTitle` reads today (same sources, unescaping, trim, companion cut, Latin/Hebrew rules).
   - When the value contains ` / `, the part after the last ` / ` is `author` (trimmed; `null` unless it has a Latin letter and no Hebrew letter or digit) and the part before it is the title.
   - Then cut a trailing series parenthetical that contains `#` followed by digits, for example `(Fifty Shades, #1)`, and trim.
   - Apply the existing null rules to the resulting title.
2. `pageOriginalTitle(html)` becomes `pageOriginal(html)?.title ?? null`. All existing tests keep passing unchanged.

# Tests (add to `tests/functions/simania-page.test.ts`)

The fixtures below already exist in `tests/functions/fixtures/simania-page/`: trimmed real pages measured on 2026-11-05.

1. `997264.html` (`Educated / Tara Westover`) → `{ title: "Educated", author: "Tara Westover" }`.
2. `962126.html` (`Fifty Shades of Grey (Fifty Shades, #1)`, with trailing spaces) → `{ title: "Fifty Shades of Grey", author: null }`.
3. `981260.html` (`THE NIGHTINGALE`) → `{ title: "THE NIGHTINGALE", author: null }`.
4. The four older fixtures give the same titles as before, with `author: null`; `659042.html` gives `null`.
5. Inline cases:
   - `A / B / Jane Roe` → title `A / B`, author `Jane Roe`.
   - `Title / 1999` → author `null`, title `Title`.
   - `Saga (Book #2) + Companion` → `Saga`.

# Acceptance criteria

1. The behavior above; all tests pass.
