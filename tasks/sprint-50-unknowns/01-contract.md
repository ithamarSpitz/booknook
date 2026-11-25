---
id: S50-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const k of ['**Run health formats (S50).**','**End-of-run recheck (S50).**','**Rematch covers the measurement (S50).**','**Duplicate works (S50).**','**Evidence classes (S50).**'])if(!t.includes(k))throw new Error(k)"
---

# Goal

Add five general rules to `docs/contract.md`, right after the S49 rules, with these exact bold names. No book-specific constants. Spend few tokens.

Measured on 2026-11-25 with the S49 code (local DB copy, `measure:links --cache-dir`): of 488 in-use works, 92 are unlinked.

| Class | Count |
|---|---|
| missed | 3 |
| Hebrew label without an edition | 3 |
| failed | 15 |
| no evidence | 71 |

That gives a range of 0.61% to 4.3%.

The three misses have three general causes:
- **Duplicate work:** a work whose Hebrew editions are linked to another work with the same title and author.
- **Gated check:** a work that the rematch skips as `no_candidate` although `decideMissedTranslation` finds it.
- **Rejected candidate:** a work skipped as `rejected`.

NLI search by English title or by Hebrew title found the known Hebrew edition for only 1 of 4 and 1 of 2 known translations, so NLI absence is not evidence of no translation.

1. **Run health formats (S50).** `check:run-health` accepts all three output formats: `rematch:cached` (a `works` summary), `measure:links --all --sample` (`sampled` / `failed_in_sample`), and the default in-use `measure:links` (`unlinked_in_use` / `failed`). It is unhealthy when failures are more than half of the checked works.
2. **End-of-run recheck (S50).** Before printing its summary, `rematch:cached` (English and `--hebrew`) and `measure:links` run every work or edition that ended as a provider failure once more, one at a time, with the same cache. The second result replaces the first. The summary adds `rechecked: N`.
3. **Rematch covers the measurement (S50).** In the English pass, when a work has no proposal and no provider failure, `rematch:cached` always runs `decideMissedTranslation`, whether or not the candidate search listed books by the author. When it finds a book, that becomes the `author_books` proposal, or a skip with its reason (`author_mismatch`, `nli_english_mismatch`, `linked_elsewhere`).
4. **Duplicate works (S50).** When the Hebrew edition found for a work is already linked to another work with the same normalized original title and an agreeing author, the cases are:
   - `rematch:cached` skips it as `linked_elsewhere` with `duplicate_of: <hardcover_id>`;
   - `measure:links` classes it `duplicate_work`, counts it in `missed`, and lists it in `duplicate_titles`;
   - an edition linked to a work that does **not** match is classed `linked_other_work`, counted as unknown, and listed in `linked_other_titles`, because it may be a wrong link.
5. **Evidence classes (S50).** `measure:links` splits the works that are neither missed nor failed by how far the independent check got:
   - `no_english_author`;
   - `no_hebrew_author`;
   - `no_author_books`: the Simania author listing was empty;
   - `catalog_truncated`: the author listing hit its page cap;
   - `unbridged_books`: at least one listed book got no original from NLI or Wikidata;
   - `catalog_checked`: every listed book got an original and none matches.

   Only `catalog_checked` and `no_english_author` count as fine. The output keeps `missed_rate_low` and `missed_rate_high`, and adds `missed_rate_strict_high`, which also counts every other evidence class as unknown. `hebrew_label_titles` lists only works whose class is the Hebrew-label one.

Change nothing else.
