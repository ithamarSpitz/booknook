---
id: S28-T2
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S28-T1
allowed_paths:
  - supabase/functions/_shared/bridges.ts
  - tests/functions/nli-original.test.ts
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

`nliOriginalFromRecords` in `supabase/functions/_shared/bridges.ts` scores a record's Hebrew title as the maximum Dice against the full 245 title, against 245 `a` alone, and against Hebrew 246 `a` values. Contract: "**NLI main title (S28).**".

# Scope

- Add the 245 `a` and Hebrew 246 `a` values to the parsed NLI record. Keep `title` as it is today.
- In `nliOriginalFromRecords`, use the maximum Dice as `titleScore`, for both the `0.78` filter and the ranking.
- Do not change `nliHebrew`.
- Change nothing else.

# Tests

In `tests/functions/nli-original.test.ts`, with MARC XML fixtures in the file's existing style:

1. 245 `$a טואיצ'י שלי : $b הסיפור שטרם סופר /`, 041 `$a heb $h eng` and 240 `$a Jungle - to the edge. $l Hebrew`: `nliOriginal("טואיצ'י שלי", "קווין פ' גייל")` gives the title `Jungle - to the edge`.
2. 245 `$a מדהימות : $b [היופי הוא חיצוני בלבד] /` and 240 `Flawless.` give `Flawless` for `מדהימות`.
3. 245 `$a WILD : $b מסע רגלי לגילוי עצמי /`, 246 `$i על המעטפת: $a הולכת רחוק` and 240 `Wild.` give `Wild` for `הולכת רחוק`.
4. A record whose 245 `a`, full 245 and Hebrew 246 values all score below `0.78` is still dropped.
5. A Latin 246 `a` (for example `Flawless /`) does not count as a Hebrew title for the score.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
