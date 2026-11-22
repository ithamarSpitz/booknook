---
id: S45-T2
stage: 2
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S45-T1
allowed_paths:
  - docs/contract.md
context:
  - contract
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "if(!require('fs').readFileSync('docs/contract.md','utf8').includes('**Hebrew direction (S45).**'))throw new Error('missing')"
---

# Goal

Read `docs/reports/2026-11-22-hebrew-dictionary-study.md`. Add one general rule to `docs/contract.md`, after the S44 rules, under the exact bold name **Hebrew direction (S45).** No book-specific constants.

1. **Always:** `rematch:cached --hebrew --explain` adds an `explain` object to every Hebrew skip line, with these fields:
   - `translator`;
   - `original` (`{title, source}`);
   - `english_author` (`{name, source}`);
   - `hardcover_queries`, at most 6, each `{query, results, best_title, best_score}`;
   - `stop`: one of `no_original`, `no_english_author`, `no_hardcover_result`, `title_below_threshold`, `author_mismatch`, `guard_rejected`.

   Without `--explain`, the output is unchanged.
2. **Only if the study shows `found > 0` and `wrong / found < 0.05`:** when `resolveMatch` finds nothing, `--hebrew` tries the dictionary title (Hebrew to English) as one more source, with the same author agreement and the S43 `nli_english_mismatch` guard. Proposals from this step use `via: "hebrew_dictionary"`. Quote the study's numbers in the rule.

   If the study doesn't meet that bar, write only part 1 and state the study's result in one sentence.

Change nothing else.
