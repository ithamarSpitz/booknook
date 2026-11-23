---
id: S46-T1
stage: 1
model_class: worker
timeout_minutes: 60
review: true
depends_on: []
allowed_paths:
  - scripts/study/guard-hebrew-study.ts
  - scripts/study/hebrew-dictionary-study.ts
  - docs/reports/2026-11-23-guard-hebrew-study.md
  - docs/reports/2026-11-23-hebrew-dictionary-study.md
context:
  - architecture.matching
environment: null
verification:
  - >-
    node -e "const f=require('fs');for(const p of ['docs/reports/2026-11-23-guard-hebrew-study.md','docs/reports/2026-11-23-hebrew-dictionary-study.md']){const m={};for(const l of f.readFileSync(p,'utf8').split(String.fromCharCode(10))){const i=l.indexOf(': ');if(i>0&&!isNaN(+l.slice(i+2)))m[l.slice(0,i).trim()]=+l.slice(i+2)}for(const k of ['checked','right','wrong','unknown'])if(!(k in m))throw new Error(p+' '+k);if(m.unknown*2>m.checked)throw new Error(p+': over half unknown, the check does not settle cases')}"
---

# Goal

Two read-only studies. They decide what S46 builds later. **Spend few tokens:** run scripts instead of reading code.

The 2026-11-22 study failed because it checked each find against NLI's original title. These editions have no NLI original, which is why they are unlinked, so everything came out `unknown`. Use the check below instead. **The verification fails if over half the cases come out `unknown`.**

## The independent check (both studies)

A pair (Hebrew Simania edition, English Hardcover book) is:
- **`right`** if the English book's Wikidata entity has a Hebrew label whose similarity to the Hebrew title is at least 0.6, and the authors agree;
- **`wrong`** if that entity's Hebrew label exists and is dissimilar (below 0.4), or the authors disagree;
- **`unknown`** otherwise.

To find the entity: `wbsearchentities` on the English title, then `wbgetentities` with labels, descriptions and claims. Accept an entity only if its P50 author, or its description, matches the English author. Author agreement uses `sameAuthor` from `supabase/functions/_shared/author-sound.ts`, or a surname match.

Our working Wikidata Hebrew-label lookup is `tasks/sprint-46-hebrew-gaps/examples/wdhe.ts`. It gave the expected answer on 5 of 5 titles on 2026-11-22. Throttle with `throttledWikimediaFetch` from `scripts/measure-links.ts`.

## Study A: is the S43 guard rejecting right books on the Hebrew side?

Read the 35 `"stop":"guard_rejected"` lines in `tasks/sprint-46-hebrew-gaps/data/heb-explain.jsonl`. For each line:
- recover the rejected candidate: rerun `resolveMatch` for that `simania_id` with the `trace` hook, or take `best_title` from `hardcover_queries`;
- apply the check.

Write `docs/reports/2026-11-23-guard-hebrew-study.md`: the lines `checked: N`, `right: N`, `wrong: N`, `unknown: N`, then a table of every pair.

## Study B: does a Hebrew-to-English dictionary step find right books?

Use `scripts/lib/dictionary.ts`. Our working English-direction study is `tasks/sprint-46-hebrew-gaps/examples/dict3.ts`. Its rule (no contradicted Hebrew word, both sides ≥ 0.67) gave 5 of 13 right accepted and 0 of 9 wrong accepted. For each of the 136 cached Hebrew editions with no work:
- translate the title;
- search Hardcover;
- apply the author agreement;
- apply the check to each find.

Write `docs/reports/2026-11-23-hebrew-dictionary-study.md` in the same format.

## Limits (both studies)

- **Database:** `BOOKNOOK_ENV_FILE=C:/Users/itas1/book-discovery-plan/.env.local`, opened with `openProdDb({ readOnly: true })`. Never write to it.
- **Secrets:** never print secrets or cat the env file.
- **Hardcover:** use the API only, at most 400 calls, at most 1 call per second. Wait on 429.
- **Sources:** make no requests to the Hardcover website.
- **Running:** `C:/Users/itas1/torimitor/node_modules/.bin/deno run --allow-net --allow-env --allow-read --allow-write --allow-sys scripts/study/<file>.ts`

# Acceptance criteria

1. Both reports have real numbers.
2. The verification passes, including the rule that no more than half the cases are `unknown`.
