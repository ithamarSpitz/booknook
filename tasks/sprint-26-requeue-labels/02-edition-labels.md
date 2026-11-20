---
id: S26-T2
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S26-T1
allowed_paths:
  - supabase/functions/_shared/catalog.ts
  - tests/functions/match-title.test.ts
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

`matchTitle` in `supabase/functions/_shared/catalog.ts` removes trailing edition labels after ` - ` or ` – `. Contract: "**Edition labels (S26).**".

# Scope

Change only `matchTitle`. Keep the existing `[...]` and `(...)` rules. Loop over all three rules until nothing changes. Never return an empty string.

# Tests

In `tests/functions/match-title.test.ts`:

| Input | Expected |
|---|---|
| `בורות - מהדורת 2003` | `בורות` |
| `כמה טוב להיות פרח קיר - עטיפת הסרט` | `כמה טוב להיות פרח קיר` |
| `טירת הזכוכית - מהדורה מחודשת` | `טירת הזכוכית` |
| `התלקחות - משחקי הרעב 2 - כריכה קשה` | `התלקחות - משחקי הרעב 2` |
| `אידיוט - כרכים א'-ב' [מהדורת 1993]` | `אידיוט` |
| `1984 [מהדורת 2003]` | `1984` |
| `יומני רובורצח - כרך 1` | unchanged |
| `ספר – מהדורה שנייה` (en dash) | `ספר` |
| `מהדורה מחודשת` (the whole title is a label) | unchanged |
| `בית-ספר` (hyphen without spaces) | unchanged |

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
