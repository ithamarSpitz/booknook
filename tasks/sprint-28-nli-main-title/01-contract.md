---
id: S28-T1
stage: 1
model_class: worker
timeout_minutes: 20
review: true
allow_protected: true
depends_on: []
allowed_paths:
  - docs/contract.md
context:
  - contract
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**NLI main title (S28).**','Jungle - to the edge','Flawless'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes S28. Measured on prod NLI on 2026-11-20: three translations on readers' shelves stay unlinked. Each NLI record has `041 $h eng` and a 240 original, but the record is dropped because the Hebrew-title Dice against the full 245 title (subfields a/b/n/p) is below `0.78`:
- Simania 996119 `טואיצ'י שלי` by `קווין פ' גייל`: 245 `$a טואיצ'י שלי : $b הסיפור שטרם סופר`, 240 `Jungle - to the edge.`;
- Simania 958612 `מדהימות` by `שרה שפרד`: 245 `$a מדהימות : $b [היופי הוא חיצוני בלבד]`, 240 `Flawless.`;
- Simania 975634 `הולכת רחוק` by `שריל סטרייד`: 245 `$a WILD : $b מסע רגלי לגילוי עצמי`, 246 `$i על המעטפת: $a הולכת רחוק`, 240 `Wild.`

# Scope

1. A paragraph **NLI main title (S28).** right after the NLI fallback bridge rule (rule 2) and the paragraph **NLI title page verso (S27).**:
   - In the add-book NLI record rules, the Hebrew-title Dice of a record is the maximum of the Dice against:
     - the full 245 title (a/b/n/p, as today);
     - 245 subfield `a` alone, with trailing spaces, `:`, `/`, `;`, `,` and `.` removed;
     - each 246 subfield `a` that has a Hebrew letter, cleaned the same way.
   - The `0.78` threshold, the ranking and the other rules are unchanged. The ranking uses this maximum as the title term.
   - It does not change `nliHebrew` (it scores original titles, not Hebrew titles).
   - Examples: the three cases above give `Jungle - to the edge`, `Flawless` and `Wild`.

Change nothing else.
