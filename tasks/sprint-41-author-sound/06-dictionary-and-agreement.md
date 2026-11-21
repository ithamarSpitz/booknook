---
id: S41-T6
stage: 6
model_class: worker
timeout_minutes: 40
review: true
depends_on:
  - S41-T5
allowed_paths:
  - scripts/lib/dictionary.ts
  - scripts/lib/rematch.ts
  - tests/functions/dictionary.test.ts
  - tests/functions/dictionary-contradictions.test.ts
  - tests/functions/rematch-author-agreement.test.ts
  - tests/functions/rematch-cached.test.ts
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

Contract: "**Dictionary contradictions (S41).**", plus one addition to "**Rematch author agreement (S40).**".

# Scope

1. **`scripts/lib/dictionary.ts`:** export `dictionaryVerdict(hebrewTitle, englishTitle, glosses)`, which returns `{ english, hebrew, contradicted }`:
   - `english`: today's `dictionaryScore`, unchanged.
   - Hebrew words: `hebrewTitle.match(/[֐-׿']+/gu)` (geresh kept inside the word), minus the stop words `של על את עם אל גם כי או`.
   - For each Hebrew word: its glosses are those of the first `wordForms(word)` form that has any. The word **hits** when its glosses cover (the existing `covered` rule) some English content word, the same word set `dictionaryScore` uses. It is **contradicted** when it has glosses but covers none. A word with no glosses is neither.
   - `hebrew` = hits / number of Hebrew words (0 when there are none). `contradicted` = the number of contradicted words.
2. **`pickByDictionary`:**
   - A candidate qualifies only when `english >= 0.67`, `hebrew >= 0.67`, and `contradicted === 0`.
   - Among qualifying candidates, rank by `english + hebrew`. The best must be unique; on a tie, return null. Otherwise return the best.
   - Keep `dictionaryScore` exported and unchanged.
3. **`authorAgreesWithWork`** (`scripts/lib/rematch.ts`) is also true when `sameAuthor(variant, englishAuthor)` (from `supabase/functions/_shared/author-sound.ts`) is true for some author variant and some English author. The S40 conditions stay as they are.

# Tests

New `tests/functions/dictionary-contradictions.test.ts`, with stubbed glosses for every form `wordForms` produces. Real 2026-11-21 pairs:
1. `מאדים הירוק` / Red Mars: `מאדים`→Mars, `ירוק`→green → contradicted, not picked.
2. `מאדים האדום` / Red Mars: `אדום`→red → picked.
3. `הנסיכה מתגעגעת` / The Princess Diaries: `נסיכה`→princess, `מתגעגעת`→no glosses → hebrew 0.5, not picked.
4. `עשב` / Grass: `עשב`→grass → picked.
5. Two candidates qualify with the same score → null.

In `tests/functions/rematch-author-agreement.test.ts`, add:
- `authorAgreesWithWork("לויס לורי", ["Lois Lowry"], [])` is true;
- `authorAgreesWithWork("ג'ני האן", ["Jenny Han"], [])` is true;
- the S40 Dan O'Sullivan case stays false.

Existing tests pass. Update an existing dictionary or rematch test only when it expects a pick that the new rule refuses, and keep its case and inputs.

# Acceptance criteria

1. The behavior above; both verification commands pass.
