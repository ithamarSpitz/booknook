---
id: S22-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Guard precision (S22).**','Elwyn Brooks','--all','No English author'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes S22: the author guard stops blocking correct links (no English author, a Hebrew-original book, initials, silent letters), and the audit can check every linked edition.

# Protected-path permission (operator decision, 2026-11-20)

`docs/contract.md` is protected. Permitted: edits A-C below, word for word. Not permitted: any other change, or any other file. The reviewer must fail the task otherwise.

# Edits

## A. Insert right after the "**Author guard (browser, S21).**" paragraph and its bullets

**Guard precision (S22).** `authorGuardRejects` also never rejects when:
- **No English author:** `englishAuthors` has no non-empty entry.
- **Hebrew-original book:** every non-empty English author contains a Hebrew letter. This covers Hebrew-original works whose `original_authors` are Hebrew.

The audit's row filter uses the same rules. `nameSoundScore` must also score these same-person pairs at least 0.6:
- אלוין ברוקס וייט / E.B. White. An initial matches a full first or middle name that starts with that sound; "E.B." stands for Elwyn Brooks.
- יו האווי / Hugh Howey. A silent "gh" counts as nothing.
- ג'יי. קיי. רולינג / J.K. Rowling.

It must score ג'קלין ווילסטון / David Sierra Listón at most 0.3 (Jacqueline Wilson; a wrong link to Fiesta a medianoche). All S21 pairs and existing name-sound tests keep their side. Measured 2026-11-20: of 499 linked editions, the S21 guard flagged 19. 14 were wrong links and 5 were correct: Charlotte's Web, Wool, טווס בחדר מדרגות, Zen and the Art of Motorcycle Maintenance (no English author), How to Change Your Mind (no English author).

## B. Append to the "**`npm run audit:authors`**" paragraph

With `--all` it checks every linked positive-ID edition, not only those used by a reader (S22). The output format is the same, and `totals` gains `"scope": "all"` or `"scope": "used"`.

## C. Known cases

In the "Must not link:" paragraph, after the S21 Blue Exorcist sentence, add: "Fiesta a medianoche (Pedro Mañas, David Sierra Listón) to 60087 בחצות הלילה by ג'קלין ווילסטון (S22)."

# Acceptance criteria

1. The diff is exactly edits A-C; `npm run check:contract` and the verification command pass.
