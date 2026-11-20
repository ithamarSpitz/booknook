---
id: S25-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Hebrew points (S25).**','U+0591','U+05BE','1027689','nameSoundScore(simaniaAuthor, englishAuthors) >= 0.8','Don Quixote'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes two S25 matching fixes, measured on prod on 2026-11-20.

# Scope

1. Add a paragraph **Hebrew points (S25).** next to the other matching rules (near "**Title-match verification.**").
   - Every Hebrew text comparison ignores Hebrew points and cantillation marks: characters U+0591 to U+05C7 are removed, except U+05BE (maqaf), which becomes a space.
   - This applies before `normalize` and `similarity` (browser `public/js/simania.js`, server `_shared/utils.ts`) and before the name skeletons of `nameSoundScore` (`public/js/names.js`, `_shared/names.ts`). It therefore also applies to `titleMatch`, `mainTitle` and the candidate rules, on both sides.
   - Measured: Simania 1027689 is titled `אִינְטֶרְמֶצּוֹ` (Sally Rooney, Intermezzo). `similarity("אינטרמצו", "אִינְטֶרְמֶצּוֹ")` was `0`, because each point became a space. The hint `אינטרמצו` and rule A's candidate both missed it.
   - Stored and displayed titles do not change.
2. In **Title-match verification.**, add a third way to verify:
   - The Simania book's author sounds like one of the card's English authors: `nameSoundScore(simaniaAuthor, englishAuthors) >= 0.8`.
   - `englishAuthors` is the card's `author` split on `,` and trimmed, with empty parts dropped.
   - This check runs after the `hebrew_author` Dice check and before `match-by-author`. When it passes, no `match-by-author` call is made, and `resolve_status` is `nli` when `hebrew_hint.source` is `nli`, else `wikidata`.
   - Measured: Don Quixote (Miguel de Cervantes Saavedra, Roberto González Echevarría) has the hint `דון קישוט` and no `hebrew_author`. Simania 64376 `דון קישוט איש למנשא` by `מיגל דה סרוואנטס` (sound 0.86) was rejected, because `match-by-author` needs the server to resolve that edition back to English, and Wikidata and NLI do not know it.
   - Still not verified this way: Aurora (Kim Stanley Robinson) with `כיבוי אורות` by David Koepp; Shades of Grey (Jasper Fforde) with `חמישים גוונים של אפור` by E. L. James. Their authors do not sound alike.

Change nothing else.
