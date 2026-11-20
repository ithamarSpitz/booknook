---
id: S29-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Simania match rules (S29).**','982600','match-replay.jsonl'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes S29: three changes to the browser Simania match (recommendation step 2, `matchHebrewBook` in `public/js/simania.js`).

Measured on prod on 2026-11-21, over the 249 used English works that get a Hebrew hint. Each work's step 2 results were saved in `tasks/sprint-29-match-rules/reference/match-replay.jsonl`.
- **Catching Fire.** The hint `משחקי הרעב - התלקחות` (by `סוזן קולינס`) scores **0.67** title Dice against both `טרילוגיית משחקי הרעב` (980165, the trilogy box set) and `התלקחות - משחקי הרעב 2 - כריכה קשה` (982600). Provider order picks the box set, so the work stays English-only. Every hint word appears in 982600's title.
- **The Outsider (Stephen King).** The hint `זר`: the search `זר סטיבן קינג` returns six other King books and no `זר`. Only the title search finds 994441.
- **Labels.** Editions that differ only by a trailing label such as `[מהדורת 2017]` lose Dice, and that alone can decide a tie.

A prototype of the rules below, run on the replay file, kept all 213 picks that equal a prod link, fixed Catching Fire, and changed nothing else except one choice between two unlinked editions of an already-linked work. Simpler versions moved good picks to other editions (for example `הגלגול (עיבוד מחודש)`), so the order of the tie-breaks matters.

# Scope

1. A paragraph **Simania match rules (S29).** right after step 2 (**Simania match**) of the recommendation localization procedure. Its rules:
   - **Word subset.** Hint words are the letter and digit runs of the hint title after removing Hebrew points. When the hint has at least 2 words, the bridge supplied an author, the result's author Dice with that author is at least `0.6`, and every hint word appears among the result title's words, the result's title score is `max(title Dice, 0.85)`. Otherwise the title score is the title Dice. The rank score is `title score * 3 + author Dice * 2`, as before. The `0.45` accept threshold applies to the title score.
   - **Tie-breaks**, in order, after the rank score:
     1. the old score, `title Dice * 3 + author Dice * 2`;
     2. the title Dice against the result title with trailing `[...]` and `(...)` labels removed (repeated; never empty);
     3. provider order.
   - **One-word hints.** When the hint title has exactly one word, search `"<Hebrew title> <Hebrew author>"` and also the title alone, each with `limit=6`. Rank their union, with the first search's results first and duplicates (by Simania ID) dropped. This is still at most 2 Simania searches.
   - Nothing else changes. Localization still runs only for English-only cards, and `link-edition` never relinks an edition that has a `work_id`, so these rules cannot unlink or relink a linked book.
   - The replay test: `tests/web/fixtures/match-replay.jsonl`, a copy of the reference file.
     - For every case whose `current` pick is in `linked`, the new pick must equal `current`.
     - For every case with empty `linked`, the new pick must equal `current`, except Catching Fire (`hardcover_id` 175780), which must be 982600.
   - Example: Catching Fire picks 982600.

Change nothing else.
