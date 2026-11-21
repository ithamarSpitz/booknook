# Title matching

The current implementation in `supabase/functions/_shared/bridges.ts` and `simania.ts` is the baseline. Keep its behavior unless a task says otherwise.

## Hebrew edition → Hardcover (resolve)

Before any provider lookup, `matchTitle` (`_shared/catalog.ts`) strips trailing edition labels from the Simania title: trailing `[...]` or `(...)` groups, and a final ` - ` or ` – ` suffix only when that suffix contains an edition word (מהדורה, מהדורת, עטיפת, כריכה, הדפסה, כרכים). It repeats until nothing more is removed and returns the trimmed original if the result would be empty. It also collapses inner runs of whitespace to a single space. The stripped title is used for matching only; the stored edition title is unchanged.

1. Wikidata: find a written work by the Hebrew title, read its original or English label and author (`wikidataOriginal`). A prefix-only match (the Hardcover book found through the Wikidata title matches that title only up to the first colon of its own title, e.g. `Northern Lights` against `Northern Lights: Bolvangar`) is weak: step 3 (NLI) also runs, and a full NLI match wins over it.
2. Look the result up on Hardcover (`findHardcoverBook`); accept only if title and author are close after normalization.
3. If that fails, NLI: read the uniform/original title for the Hebrew record (`nliOriginal`) and repeat step 2. The record's Hebrew title is matched against the full MARC 245 title, 245 `a` alone, and each Hebrew 246 title; the best of those three match types counts. Candidates come from MARC 240, 130 and 765; after those, a 246 whose `i` starts with `Title page verso` supplies a Latin `a` title only when MARC 041 has an `h` value other than `heb`. A Latin `b` on that 246 supplies the `versoAuthor` hint. Search NLI by title and author surname first, then by title alone. NLI creators are Hebrew, so the Hardcover author hints are tried in this order: the English author of another linked edition by the same Simania author, when one exists; `versoAuthor`; the Wikidata English author bridge; then the NLI creator.
4. Nothing accepted: `resolve_status = 'not_found'`, but only when every provider answered. If any provider request failed, keep `pending` so a later request retries.
5. Record which step succeeded in `resolve_status` (`wikidata`, `nli`, `fuzzy`).

`findHardcoverBook` takes two options besides `requireAuthor` (`_shared/hardcover.ts`):

- `retryWithAuthor`: when the title-only search yields no accepted match and the author hint contains a Latin letter, search again with `<title> <author>` and rank that result list. Title Dice there is the best of the full Hardcover title, the part before the first `:`, and the book's `alternative_titles`, and the retry requires an author boost.
- `soundAuthor`: a Hebrew author name. A candidate whose authors have `nameSoundScore(soundAuthor, authors) >= 0.6` gets the same author boost as a similar English author hint.
- `boxTitle`: see "Box sets" below.

Every Hardcover match, in the first search and the author retry, also scores the title against the book's `alternative_titles` (read from the search `results` payload, keyed by book id). Title Dice is the best of the full title, the part before the first `:` and each alternative title.

### Box sets

`isBoxSet(matchTitle)` (`_shared/catalog.ts`) is true when the match title contains a whole-word box word: מארז, טרילוגיית, טרילוגיה, ערכת or סט. `boxCore` removes those words and the noise words מלא, דיגיטלי and דיגיטלית, splits on ` - ` / ` – ` and keeps the longest part. For a box set, `resolveMatch` uses `boxCore` as the title for Wikidata and NLI, and the Hardcover lookup of each bridge title tries the suffixes `Trilogy`, `Collection` and `Box Set` in that order. Each lookup passes `requireAuthor: true` and `boxTitle: true`, and a result rejected by `authorGuardRejects` is skipped. The final fuzzy path does not run for box sets.

With `boxTitle`, `findHardcoverBook` keeps only candidates whose title has a box word (Trilogy, Collection, Box Set, Boxed Set, Omnibus), removes those words from the query and from the candidate titles before scoring, and requires an author boost.

### Series and companion guards

- Wikidata bridge: `isWrittenWork` (`_shared/bridges.ts`) rejects an entity whose `P31` includes any `REJECT_TYPES` id, including Q1667921 (novel series), even if it has an author (`P50`) claim or a work type. A series entity therefore never supplies a bridge title.
- Hardcover ranking: before ranking, `findHardcoverBook` calls `dropUnwanted` (`_shared/hardcover.ts`) on the candidates. It drops a book whose title has a box word (Trilogy, Collection, Box Set, Boxed Set, Omnibus) unless the call has `boxTitle` or the query title has one. It drops a Companion book, whose title has one of the phrases `The Art of`, `The World of`, `Companion`, `Summary`, `Study Guide`, `Reader's Guide`, `Analysis`, `Coloring Book`, `Workbook` or `Untold History` as a whole phrase, unless the query title has one too.

### `resolveMatch`

`resolveMatch(db, edition, overrides)` (`_shared/catalog.ts`) runs the Wikidata → NLI → fuzzy decision described above. It never writes, and it ignores `resolve_status`, so it also evaluates an already linked edition. It returns `{ found: { book, status } | null, failed }`, where `failed` is true when any provider request failed. `ensureResolved` calls it and then writes the work and status. `npm run recheck:links` calls it directly.

`ensureResolved` (`_shared/catalog.ts`) passes `retryWithAuthor: true` on the Wikidata and NLI paths. On the NLI path it adds `soundAuthor` (the edition's Hebrew author) only when no English author hint was found. The final fuzzy path uses `requireAuthor` only.

Series-prefix NLI retry: when the NLI lookup of the full title finds nothing and the edition has a `series` such that the title starts with `<series> - ` (hyphen or en dash), `ensureResolved` repeats `nliOriginal` with the rest of the title. It does not retry when the rest is empty or is only a volume label (`כרך`, `ספר` or `חלק` plus one word).

Each wikidata, nli or fuzzy match is checked with `authorGuardRejects` (`_shared/fallback-match.ts`) against the Simania edition author. A rejected match is discarded and resolution falls through to the next path. A rejection is not a provider failure, so it does not keep the edition `pending`.

## Hardcover → Hebrew edition (localize)

1. Wikidata Hebrew label for the Hardcover title and author (`wikidataHebrew`), then NLI (`nliHebrew`).
2. Find that Hebrew title on Simania and keep the closest match above the existing threshold. For a hint of at least two words, when an author was supplied and its Dice agreement with the result author is at least 0.6, a result containing every hint-title word gets a title-score floor of 0.85. Results are ordered by the boosted weighted score, then the original unboosted weighted score, then title similarity after trailing bracketed or parenthesized labels are stripped, then their original search order. A one-word hint always makes a second, title-only search even when the title-plus-author search returned results; the two result lists are combined in search order and deduplicated by numeric Simania ID. This step runs in the browser (`localizeRecommendations` in `public/js/recs.js`, using `public/js/simania.js`): the `recommendations` function returns the step 1 result as `hebrew_hint`, and the browser calls `link-edition` for an accepted match.
   Box-set hint rule: unless the recommendation's English title has a box word (Trilogy, Collection, Box Set, Boxed Set, Omnibus), `localizeRecommendations` strips Hebrew box words from the hint title with `stripHebrewBoxWords` before matching. `matchHebrewBook` drops Simania results that contain a Hebrew box word (`hasHebrewBoxWord`, whole words מארז, טרילוגיית, טרילוגיה, ערכת, סט) unless the searched title itself has one.

   NLI `alternate` hint: when Wikidata supplies the Hebrew title, `recommendations` also asks NLI. If NLI answers with a title that differs after normalization, the hint carries it as `alternate`; an NLI failure leaves the hint unchanged. The browser tries `alternate` only when the main hint title found no Simania book (`match` returned null), using the same author hint and, under the same box-word rule, with box words stripped. A verified match links with source `nli`.
3. Before calling any provider, check `editions` for a row whose `work_id` is already this work. Reuse it.

`tests/web/match-replay.test.mjs` replays captured Simania result sets and guards the matcher picks that equal the production links.

4. Fallback, only when steps 1-2 and the author path missed: `hebrew-candidates` lists the author's Hebrew editions from NLI (searched by Latin authority name) with the rule that ties each one to this work. The browser accepts one only with Simania title and author agreement, or with matching character names, and only as a single clear winner. It links with `resolve_status = 'nli_author'` and never relinks. See `docs/contract.md`, "Catalog fallback for English-only books".

5. Omnibus, only when step 2 found no title match (`localizeRecommendations`). `matchOmnibus(hintTitle, results)` (`public/js/simania.js`, pure) looks at a Simania search for the hint title (6 results). A result counts when its `subtitle` splits on ` | ` into at least 2 parts and some part has `similarity >= 0.9` with the hint title. It returns the result only when exactly one result counts, otherwise null. The browser also requires author agreement: `similarity(hebrew_author, result author) >= 0.6` when the recommendation has a Hebrew author, otherwise `nameSoundScore(result author, English authors) >= 0.8`. A search failure leaves the card unchanged and the author path continues. The link gets `resolve_status = 'omnibus'`. `npm run report:omnibus` lists these links.

### Series links (`npm run series:links`)

`scripts/series-links.ts` is an operator tool, not part of `resolve`. It targets positive editions with `resolve_status = 'not_found'`, no `work_id` and a non-empty `series`, and uses the Simania `seriesNumber` from `bookDetails` as the target number (a positive integer, else the target is skipped as `no_number`).

- **Anchors.** Linked editions with the same trimmed `series` whose author agrees with the target's (equal after removing Hebrew points and parentheses, or `similarity >= 0.6`) and that have their own `seriesNumber`. For each, the Hardcover `book_series` rows of its work are read.
- **Accepted series.** A Hardcover series is accepted when an anchor's `position` equals its Simania number there and no anchor has a different position in it. Disagreement gives `anchor_disagrees`, several accepted series `ambiguous_series`, none `no_anchor`.
- **Book pick.** The books at the target's number in that series, minus compilations and books with no author whose Dice with an anchor work's `original_authors` is above 0.45. The book with the most `users_read_count` wins only with at least 5 readers and at least 3 times the readers of every other book whose title has Dice below 0.8 with its title. Otherwise `no_book` or `ambiguous_book`.
- **Status.** `--apply` links through the `repair:links` upsert with `resolve_status = 'series'`, only where `work_id` is still null. The default run is a read-only dry run.

## Normalization

`utils.ts normalize` and `similarity` are authoritative: NFKD, Latin diacritics removed, lower case, a leading English article removed, everything that is not a letter or digit turned into a space. `similarity` is word-set Dice overlap. Display text is never changed. `stripHebrewPoints` runs first in `normalize`: it removes Hebrew points and cantillation marks (U+0591-U+05C7, except maqaf U+05BE, which becomes a space). `nameSoundScore` applies it to Hebrew names too. It exists in the browser (`public/js/simania.js`, `public/js/names.js`) and on the server (`_shared/utils.ts`, `_shared/names.ts`). Hebrew final-letter folding is not implemented; do not add it unless a task asks.

### Browser title-match verification

`verifyTitleMatch` (`public/js/recs.js`) accepts a Simania title match when any of these holds, in order:

1. the recommendation's Hebrew author is similar to the Simania author (`similarity >= 0.6`);
2. the Simania author sounds like the English author (`nameSoundScore >= 0.8`, against each comma-separated English author);
3. the `match-by-author` function confirms the candidate.

## LLM fallback

Deferred. The status value `llm` is reserved.
