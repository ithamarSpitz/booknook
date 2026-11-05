---
id: S10-T15
stage: 4
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S10-T13
allowed_paths:
  - scripts/verify-localization.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run verify:localization
---

# Goal

The live localization gate also covers the genre shelf books that were wrongly shown in English.

# Scope

In `scripts/verify-localization.ts`, add these cases to `CASES` in the existing format (`buildDb: () => ({})`). They were measured with this same chain on 2026-11-05:

| hardcoverId | label | expectedSimania |
|---|---|---|
| 39920 | Eleanor Oliphant Is Completely Fine | 987746 |
| 490300 | Lessons in Chemistry | 1005415 |
| 143390 | The Ballad of Songbirds and Snakes | 998308 |
| 80 | Cell (author path) | 144805 |

Add a fifth case, 447329 Daisy Jones & The Six → 1002921. Its `buildDb` seeds a catalog work by `Taylor Jenkins Reid` with the Hebrew edition 1006655 `שבעת הבעלים של אוולין הוגו` by `טיילור ג'נקינס-ריד`, plus a newer English edition (negative ID, author `Taylor Jenkins Reid`). The case proves that the Hebrew author comes from the positive edition (S10-T6) and that the chain then finds 1002921 (measured with the catalog seeded: path `title`, verified through the Hebrew author). Build it like the existing `mcfaddenSeed`.

Existing cases and output stay unchanged.

# Acceptance criteria

1. `npm run verify:localization` passes with all old and new cases.
