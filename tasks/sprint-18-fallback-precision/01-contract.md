---
id: S18-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['original_year','startRecord','Year guard (S18)','--replay-linked','--compare','North Woods','The Folk of the Faraway Tree','at most 4 NLI'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes S18. The catalog fallback finds more real translations: it reads every NLI record of prolific authors. It stops linking an English book to a different book by the same author: short junk name matches are dropped, and no edition older than the original is accepted. The operator tools prove that no correct link is lost.

# Protected-path permission (operator decision, 2026-11-19)

`docs/contract.md` is protected. This task may change it, and only with edits A-F below, using the given text word for word.

Not permitted: any other change to `docs/contract.md`, or any other file. The reviewer must fail the task if the diff changes anything outside A-F.

All edits are in "### Catalog fallback for English-only books (`hebrew-candidates`)" and the paragraphs that follow it.

# Edits

## A. Response

In the line starting "- Request `HebrewCandidatesRequest`", replace `"english_names":["..."]}`.` with `"english_names":["..."],"original_year":1987|null}`. `original_year` (S18) is the work's Hardcover `release_year`, taken from the same single Hardcover request that gives the description; null when Hardcover has none or the request fails.`

## B. NLI paging (rule A input)

In the line starting "- NLI records:", replace `` `maximumRecords=100`. `` (the first occurrence, right after the creator query) with `` `maximumRecords=100`, read page by page with `startRecord` 1, 101 and 201 (S18), stopping after a page with fewer than 100 records, so at most 300 records. Measured 2026-11-19: NLI has 110 records for Enid Blyton, 131 for Stephen King and 176 for Agatha Christie, so one page missed their later records. ``

## C. Bounds

In the line starting "- Bounds:", replace "at most 2 NLI, 4 Wikidata and 1 Hardcover requests per call, within 20 seconds." with "at most 4 NLI (3 creator pages and the uniform-title query), 4 Wikidata and 1 Hardcover requests per call, within 25 seconds."

## D. Rule G names

In the rule **G.** line, replace "`english_names` holds the capitalized words of length ≥ 3" with "`english_names` holds the capitalized words of length ≥ 5 (S18; was 3)". In the same sentence, add "Choice" to the stop list examples, after "Called".

Then add this sub-bullet right after the rule **G.** line (before "NLI 100 author"):
  - Measured 2026-11-19 (S18): short names sound-match ordinary Hebrew words. The Folk of the Faraway Tree (Enid Blyton) hit 103718 הרפתקאות ג'ימי ילד הקרקס only through "Beth" and "Wood". North Woods (Daniel Mason) hit 223491 ארץ רחוקה (his 2008 novel A Far Country) through "Poe", "Thoreau", "Choice" and "Chicago", which are authors and a city named in the blurb. The first is stopped by the length rule; the second by the year guard below.

## E. Browser decision

In "**Browser decision (`localizeFallback` in `public/js/recs.js`).**", insert a new step right after step 3 ("Rules E and F: ...") and before step 4 (Rule G):

3a. **Year guard (S18).** For rules E, F and G only: when `original_year` is a number, skip every Simania result or found edition whose `year` is a number below `original_year − 1`. A translation cannot come out before its original; the one-year margin allows for date differences. For rule G, a skipped edition is not a found edition: it gives no hits, does not count against another edition, and its details are not read. Rules A-D are unchanged, because their title evidence is strong and an old reissue year on Hardcover must not drop them.

## F. Known cases and operator tools

1. In the "Must not link:" paragraph, add before "The two wrong links were": "The Folk of the Faraway Tree (Enid Blyton) to 103718 הרפתקאות ג'ימי ילד הקרקס; North Woods (Daniel Mason) to 223491 ארץ רחוקה (S18; NLI has no Hebrew edition of either, checked 2026-11-19)."

2. In "**Population review.**", add after "It writes nothing.": "In this review and in every mode below, a Wikidata `429` that remains after the function's own retry makes the script wait 30 seconds and run that book again, up to 3 times (S18). A book that still fails is printed with `errors`, as before."

3. Add a new paragraph right after the "**Population review.**" paragraph:

**No-regression tools (S18).**
- `npm run verify:fallback -- --replay-linked` runs the same read-only fallback decision for every work that has a linked positive-ID edition and is on any reader's shelf, recommendation or genre row. Each work is treated as if it were English-only; nothing is written. It prints one JSON line per work: `hardcover_id`, `title`, `author`, the current linked `simania_id` values and their `resolve_status`, the decided `simania_id`, `rule`, rule G evidence and `errors`. Then it prints the totals: works, decided, `same_as_linked`, `different_from_linked`, none, and errors.
- `npm run verify:fallback -- --compare <before.jsonl> <after.jsonl>` reads two outputs of the same mode, matched by `hardcover_id` for replay output and by `title` + `author` for population output. It prints every book whose decided `simania_id` or `rule` changed, as one JSON line `{ key, before, after }`. Books with `errors` in either file are listed separately as `unverified`. Then it prints the counts. It exits `1` when a book changed from deciding an ID that equals its current link (replay) or that the operator marked correct to deciding something else or nothing. Otherwise it exits `0`. The marks come from an optional `--keep <file>`: one key per line.
- Operator rule for S18 and later fallback changes: run `--population` and `--replay-linked` on the code before the change and on the code after it, then `--compare` each pair. No `refresh:all -- --apply` until every changed book is reviewed, and every book that was decided correctly before is still decided the same way.

# Acceptance criteria

1. The diff is exactly edits A-F.
2. `npm run check:contract` passes, and the verification command finds every new name.
