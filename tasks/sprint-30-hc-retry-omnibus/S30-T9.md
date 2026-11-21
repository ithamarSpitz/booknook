---
id: S30-T9
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: true
depends_on:
  - S30-T1
allowed_paths:
  - docs/contract.md
context:
  - contract
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Hardcover alternative titles (S30).**','npm run series:links','101133','book_series'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes two more S30 rules. Both are general: app code holds no book-, series- or author-specific constants.

Measured on prod on 2026-11-21:
- **Ferrante.** NLI bridges Simania 985271 `הסיפור של מי שברחו ושל מי שנשארו` to the Italian `Storia di chi fugge e di chi resta`, and the Wikidata author is `Elena Ferrante`. The search `Storia di chi fugge e di chi resta Elena Ferrante` returns one book: 101133, `Those Who Leave and Those Who Stay`. Its search document's `alternative_titles` contain the Italian title. The English title alone scores below `0.5`.
- **Series numbering.** Some translated series editions have no bridge at all. Simania gives `series` and `seriesNumber`, for example `השביעיה הסודית` #3, #4, #6, #14. One edition of that series, #4, is already linked to a Hardcover book whose `book_series` row has `position` 4 in Hardcover series 10178.
  - Hardcover `book_series` rows were verified live on 2026-11-21: `book_series(where:{book_id:{_eq:<id>}}){ position series_id }` and `book_series(where:{series_id:{_eq:<id>}, position:{_eq:<n>}}){ book_id book { id title slug users_read_count compilation cached_contributors cached_similar_book_ids cached_tags image { url } } }`.
  - One position can hold several Hardcover books: several editions of one title, and sometimes a wrong one, for example position 14 has `Look Out, Secret Seven` with 26 readers and `The Secret Seven` with 1.

# Scope

1. After "**Hardcover author retry (S30).**", add:
   - **Hardcover alternative titles (S30).** In the retry search only, request `results` together with `ids`. A book's title Dice is the maximum over:
     - its full title;
     - the part of the title before the first `:`;
     - each entry in its search document's `alternative_titles`.

     The author evidence rule and everything else are unchanged. Example: the Ferrante case gives 101133.
2. Add `series` to the `resolve_status` values.
3. Under **Operator scripts**, add **`npm run series:links`** (`scripts/series-links.ts`, S30): it links unresolved series editions by their series position. Dry run by default, `--apply` to write, `--simania <id>` for one edition.
   - **Targets.** Positive editions with `resolve_status` `not_found`, `work_id` null and a non-empty `series`, which a shelf, recommendation or genre row references. With `--simania`, only that one, referenced or not.
   - **Target number.** The Simania `seriesNumber` from `bookDetails`. It must be a positive integer string, else the target is skipped with reason `no_number`.
   - **Anchors.** Linked positive editions whose trimmed `series` equals the target's and whose author agrees with the target's: equal after removing Hebrew points and parentheses, or `similarity >= 0.6`. Each needs an integer `seriesNumber` from `bookDetails`. For each anchor, read its work's `book_series` rows.
   - **The Hardcover series.** A Hardcover series `S` is accepted when:
     - at least one anchor has a row in `S` whose `position` equals its Simania number;
     - no anchor has a row in `S` with a different position (reason `anchor_disagrees`).

     More than one accepted series gives reason `ambiguous_series`; none gives `no_anchor`.
   - **The book.** Read the books at position `M` (the target's number) in `S`. Drop compilations and books with no contributor whose name has Dice greater than `0.45` with some anchor work's `original_authors`. Then take the book with the most `users_read_count`. Accept it only when:
     - it has at least `5`;
     - it has at least 3 times the readers of every remaining book whose title has Dice below `0.8` with its title.

     Otherwise the reason is `ambiguous_book` or `no_book`.
   - **Output.** One JSON line per target: `simania_id`, `title`, `series`, `number`, `anchors` (`simania_id`, `number`, `position`), `series_id`, then `proposal` (`hardcover_id`, `title`, `users_read_count`) or `reason`. Then `{ "proposals": n, "skipped": n }`.
   - **`--apply`.** In one transaction per proposal: upsert the work as `repair:links` does, then set `work_id`, `resolve_status = 'series'` and `resolved_at = now()` only where `work_id` is still null. Then print `{ "linked": n }`.
   - **Hardcover budget.** It runs the same Hardcover budget check as `refresh:all` (`--min-hardcover`, default `1500`; `--force-hardcover`; exit `4`). It makes requests one at a time.
   - **Review.** The operator reviews every proposal before `--apply`. `report:omnibus`-style review applies: `series` links can be listed by status.

Change nothing else.
