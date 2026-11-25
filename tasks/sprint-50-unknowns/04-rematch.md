---
id: S50-T4
stage: 3
model_class: worker
timeout_minutes: 90
review: true
depends_on:
  - S50-T3
allowed_paths:
  - scripts/rematch-cached.ts
  - tests/functions/rematch-author-books.test.ts
  - tests/functions/rematch-recheck.test.ts
  - tests/functions/rematch-concurrency.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "const t=require('fs').readFileSync('scripts/rematch-cached.ts','utf8');if(/!linkedElsewhere\s*&&\s*authorBooks\.length\s*>\s*0/.test(t))throw new Error('the authorBooks gate on decideMissedTranslation must go');for(const k of ['duplicate_of','rechecked'])if(!t.includes(k))throw new Error(k)"
---

# Goal

In `scripts/rematch-cached.ts`, implement the rematch parts of **Rematch covers the measurement (S50)**, **Duplicate works (S50)** and **End-of-run recheck (S50)**. Spend few tokens.

1. **Gate.** The `author_books` step is guarded by `!proposal && !anyFailed && !linkedElsewhere && authorBooks.length > 0`. `authorBooks` comes from the candidate search, but `decideMissedTranslation` does its own author lookup and listing. So when the candidate search listed no books by the author, the rematch never runs the check that `measure:links` runs.

   On 2026-11-25: work 318352 *The Exorcist* was `no_candidate` in the rematch, while `measure:links` found the unlinked Simania edition 2970 by the same author. Don't special-case it.

   Remove the `authorBooks.length > 0` condition from this step, and check that the same condition doesn't block the other `author_books` call. Keep the proposal and its checks as they are: author agreement, `nli_english_mismatch`, and `linked_elsewhere`.
2. **Duplicates.** When a found Simania edition is already linked to another work (`linked_elsewhere`), load that work with one read-only query. If its normalized original title equals this work's (`normalize`) and the authors agree, add `duplicate_of: <that hardcover_id>` to the skip line.
3. **Recheck.** After the main loop and before the summary:
   - run every work (English) or edition (`--hebrew`) that ended `provider_failure` once more, one at a time, with the same deps and cache;
   - replace its output line with the second result, keeping work order in the output;
   - add `rechecked: N` to the summary, and count the final outcomes in `skipped`.

   Keep this working with `--concurrency`.
4. Trace one more case in tests: a work whose only candidate comes from `decideMissedTranslation` and whose author agreement passes must give a proposal. On 2026-11-25, work 175780 *Catching Fire* was `rejected` while `measure:links` found it. If your change doesn't explain that, write in your report which check rejects it. Don't change thresholds to make it pass.

# Acceptance criteria

1. With fake providers:
   - a work whose candidate search lists no author books, but where `decideMissedTranslation` finds an unlinked book, gives an `author_books` proposal;
   - a duplicate gives `linked_elsewhere` with `duplicate_of`;
   - a non-matching linked work gives no `duplicate_of`;
   - a work that fails first and succeeds on recheck ends with its real outcome and `rechecked: 1`;
   - with `--concurrency 3`, the output is byte-identical to `--concurrency 1`, including the recheck.
2. Existing tests pass.
3. All verification commands pass.
