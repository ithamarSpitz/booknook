---
id: S30-T2
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S30-T1
allowed_paths:
  - supabase/functions/_shared/hardcover.ts
  - tests/functions/hardcover-retry.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

`findHardcoverBook` in `supabase/functions/_shared/hardcover.ts` gets two opt-in options for the contract paragraphs "**Hardcover author retry (S30).**" and "**Hebrew author sound (S30).**". Without the new options, its behavior and requests stay exactly as today.

# Scope

- Add two fields to `FindHardcoverBookOptions`:
  - `retryWithAuthor?: boolean`
  - `soundAuthor?: string`
- **`soundAuthor`.** When it is non-empty, a book also gets the author boost (`2`) when `nameSoundScore(soundAuthor, authors(book)) >= 0.6`. Import `nameSoundScore` from `./names.ts`. The existing Dice rule is unchanged.
- **`retryWithAuthor`.** When it is true, the normal match returns `null`, and `authorHint` has a Latin letter (`/[A-Za-z]/`), run one more match:
  - search with the query `"<originalTitle> <authorHint>"`, escaped as the first query is;
  - fetch details with `hardcoverBooks`;
  - each book's title Dice is `max(similarity(originalTitle, title), similarity(originalTitle, <title before the first ":", trimmed>))`;
  - rank, the `0.5` threshold and the tie rule are as in the first pass, with `requireAuthor` forced true;
  - `soundAuthor` applies here too.

  Return that result. When the retry does not run, nothing changes.
- Keep the shared code small, for example a private helper that ranks a list of books with a given title-Dice function. Change nothing else; callers are wired in S30-T3.

# Tests

New file `tests/functions/hardcover-retry.test.ts`. Use a fetch stub in the style of `tests/functions/hardcover-match.test.ts`, but answer the `search` query by its text: return one ID list for the title-only query and another for the title+author query. Count the search requests.

1. **Wild.** The title search returns 8 books titled `Wild` by other authors (Kristin Hannah, Adrienne Wilder, D.D. Prince, Meghan O'Brien, Sophie Jordan, Renee Rose, Jay Griffiths, Hannah Moskowitz). The `Wild Cheryl Strayed` search returns:
   - 779562 `Wild: by Cheryl Strayed` by `Trivion Books`, 6 readers;
   - 52808 `Wild: From Lost to Found on the Pacific Crest Trail` by `Cheryl Strayed`, 1259 readers;
   - 2329653 `Wild: over jezelf verliezen, terugvinden & 1700 kilometer hiken` by `Cheryl Strayed`, 1 reader.

   With `{ retryWithAuthor: true }` the result is 52808 and there are 2 searches. Without the option the result is `null` and there is 1 search.
2. **Night School.** The title search returns no `C.J. Daugherty` book. The `Night School CJ Daugherty` search returns 61420 `Night School` by `C.J. Daugherty` (73 readers) and 2222086 `Night School: The Short Stories` by the same author (1 reader). The result is 61420.
3. **No Latin author, no retry.** Hint `קופ, דוד` with `retryWithAuthor: true` and an ambiguous `Aurora` tie: the result is `null`, with 1 search.
4. **A first-pass hit is final.** When the first search already matches, there is no second search and the result is unchanged.
5. **Survive.** Title search results are `Survive` by `Alex Morel` (105197, 6 readers) and `Survive` by `Other Writer` (999001, 50 readers). The hint is `מורל, אלכס`, with `soundAuthor: "אלכס מורל"`. The result is 105197. Without `soundAuthor` it is `null` (tie with no boost).
6. **Regeneration.** `Regeneration` by `Pat Barker` (435858, 178 readers), `Julie E. Czerneda` (232435, 16 readers) and `Stephanie Saulter` (469579, 5 readers). With `soundAuthor: "פאט (פט) בארקר (ברקר)"` the result is 435858.
7. **No sound match.** With `soundAuthor: "אלכס מורל"` and only books by `Bear Grylls` and `Other Writer` titled `Survive`, the result is `null`.

Existing tests pass unchanged.

# Acceptance criteria

1. The behavior above; both verification commands pass.
