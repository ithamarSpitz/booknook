---
id: S46-T2
stage: 2
model_class: worker
timeout_minutes: 20
review: true
allow_protected: true
depends_on:
  - S46-T1
allowed_paths:
  - docs/contract.md
context:
  - contract
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const k of ['**Author books path (S46).**','**Provider throttle (S46).**','**Guard on Hebrew side (S46).**','**Hebrew dictionary step (S46).**'])if(!t.includes(k))throw new Error(k)"
---

# Goal

Read the two reports in `docs/reports/2026-11-23-*.md`. Add four general rules to `docs/contract.md` after the S45 rules, with these exact bold names. No book-specific constants.

1. **Author books path (S46).** `rematch:cached` uses the same check that `measure:links` uses to count a missed translation (`decideMissedTranslation` in `scripts/measure-links.ts`) as one more English-side source. It runs after the current sources give no proposal:
   - list the unlinked Simania books by the Hebrew author;
   - bridge each one back through NLI or Wikidata;
   - an original that matches the English title (≥ 0.6 with the strip) becomes a proposal with `via: "author_books"`.

   The proposal still passes the author agreement and the S43 guard. Measured on 2026-11-23: `measure:links --all --sample 400` found 22 confirmed missed translations in its sample that the rematch had not linked, an estimated 97 of 2,971 works.

2. **Provider throttle (S46).** Every Hardcover API call from the scripts goes through one shared limiter:
   - at most 1 request per second;
   - on HTTP 429, wait for `Retry-After`, or 15 s if there is none;
   - retry up to 5 times.

   Every Wikimedia call goes through `throttledWikimediaFetch`.

   Measured on 2026-11-23: all 69 provider failures in `--hebrew` were rate limits (81 Hardcover 429 errors, 10 Wikidata 429 errors).

3. **Guard on Hebrew side (S46).** Read Study A.
   - If the S43 guard rejected **right** pairs on the Hebrew side (`right` > `wrong`), the guard does not apply to `--hebrew` proposals.
   - Otherwise it stays.

   Quote the numbers either way.

4. **Hebrew dictionary step (S46).** Read Study B.
   - If `right` ≥ 3 and `wrong / (right + wrong)` < 0.05, then when `resolveMatch` finds nothing, `--hebrew` tries the dictionary title through Hardcover with the author agreement. These proposals use `via: "hebrew_dictionary"`.
   - Otherwise there is no such step.

   Quote the numbers either way.

Change nothing else.
