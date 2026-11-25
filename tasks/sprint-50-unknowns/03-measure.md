---
id: S50-T3
stage: 2
model_class: worker
timeout_minutes: 90
review: true
depends_on:
  - S50-T1
allowed_paths:
  - scripts/measure-links.ts
  - tests/functions/measure-links.test.ts
  - tests/functions/measure-evidence.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "const t=require('fs').readFileSync('scripts/measure-links.ts','utf8');for(const k of ['catalog_checked','unbridged_books','catalog_truncated','no_author_books','no_hebrew_author','duplicate_work','linked_other_work','missed_rate_strict_high','rechecked'])if(!t.includes(k))throw new Error(k)"
---

# Goal

In `scripts/measure-links.ts`, implement the `measure:links` parts of **End-of-run recheck (S50)**, **Duplicate works (S50)** and **Evidence classes (S50)**. Spend few tokens.

1. **Evidence classes.** Today `decideMissedTranslation` returns `{ missed: false }` at several points that mean very different things:
   - no English author;
   - no Hebrew author name;
   - an empty Simania author listing;
   - a listing that reached the 300-book cap (`offset < 300`);
   - books whose NLI and Wikidata originals were both null;
   - every book bridged, with no match.

   Return which one happened, as the contract's class names, and count each class in the output. Only `catalog_checked` and `no_english_author` are counted as fine. Add `missed_rate_strict_high = (missed + hebrew_label_unconfirmed + failed + linked_other_work + no_hebrew_author + no_author_books + catalog_truncated + unbridged_books) / population`, scaled like the other rates when `--sample` is used. Keep `missed_rate_low` and `missed_rate_high` exactly as they are computed today, plus `duplicate_work` in `missed`.
2. **Duplicates.** When the book found for a work (on any path, including the `wikidata_he` label path) is a Simania edition already linked to another work:
   - **another work with the same normalized original title** (`normalize` from `_shared/utils.ts`) **and an agreeing author** (`sameAuthor` or the S40 author agreement): class `duplicate_work`. Count it in `missed`, and list it in `duplicate_titles`.
   - **any other work:** class `linked_other_work`, listed in `linked_other_titles`.

   Load the edition's work with one read-only query. Example of the first case, from 2026-11-25: work 62743 *The Strange Case of Dr. Jekyll and Mr. Hyde*, whose 3 Hebrew editions are linked to work 2332122 with the same title and author. Don't special-case it.
3. **The label list** lists only works whose class is `hebrew_label_unconfirmed`. Today it also lists missed works that had a label: 4 titles for a count of 3.
4. **Recheck.** After the main loop, run every work (and with `--hebrew`, every edition) that ended `failed` once more, one at a time. Replace its result, and add `rechecked: N` to the output.

# Acceptance criteria

1. `tests/functions/measure-evidence.test.ts`, with fake providers, covers:
   - every evidence class;
   - `duplicate_work` versus `linked_other_work`;
   - the label list holding only label-only works;
   - a work that fails first and succeeds on recheck, ending in its real class with `rechecked: 1`;
   - `missed_rate_strict_high`, arithmetic included.
2. The existing measure tests pass. Where an existing expected output must gain the new fields, add them; don't change the old values.
3. All verification commands pass.
