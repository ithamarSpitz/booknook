---
id: S23-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Resolver author guard (S23).**','Dream of the Red Chamber','nameSoundScore(hebrewTitle, [mainTitle(t)]) >= 0.7','שאטר איילנד'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes S23:
- the server resolver (Hebrew edition → English work) uses the same author guard as the browser;
- rule B accepts Hebrew titles that sound like the English title from 0.7.

# Protected-path permission (operator decision, 2026-11-20)

`docs/contract.md` is protected. Permitted: edits A-B below, word for word. Not permitted: anything else. The reviewer must fail the task otherwise.

# Edits

## A. Insert right after the "**Guard precision (S22).**" paragraph (if it is not there, right after the "**Author guard (browser, S21).**" paragraph and its bullets)

**Resolver author guard (S23).** `ensureResolved` in `supabase/functions/_shared/catalog.ts` checks every Hardcover match from the wikidata, nli and fuzzy paths with `authorGuardRejects(edition.author, matchAuthors, "")`. `matchAuthors` are the match's contributor names. The server copy of the guard is `authorGuardRejects` in `supabase/functions/_shared/fallback-match.ts`, the same rules as the browser copy, including S22's when present. A rejected match counts as no match for that path, and the resolver tries the next path. A rejection is not a provider failure, so it never makes the status `pending`. Measured 2026-11-20: after 15 wrong links were unlinked, the refresh re-made 9 of them through this resolver. One was 972426 דברי by לורי האלס אנדרסון (Speak) linked to Dream of the Red Chamber (Cao Xueqin), from a Wikidata lookup by Hebrew title only.

## B. In the `hebrew-candidates` candidate list, change rule B

Replace `nameSoundScore(hebrewTitle, [mainTitle(t)]) >= 0.85` with `nameSoundScore(hebrewTitle, [mainTitle(t)]) >= 0.7`, and add right after it: "(S23; was 0.85). Measured 2026-11-20: 85002 שאטר איילנד scored 0.73 against Shutter Island and fell to rule G, so it was never linked. The browser still requires `titleMatch` and `authorAgrees` on the Simania result."

# Acceptance criteria

1. The diff is exactly edits A-B; `npm run check:contract` and the verification command pass.
