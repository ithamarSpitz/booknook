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

Search documents and details: Hardcover matching ranks candidates built from the search documents. It falls back to the details request only when a document is missing. `ensureResolved` fetches one book's details with `hardcoverBooks` before writing a new work.

Series-prefix NLI retry: when the NLI lookup of the full title finds nothing and the edition has a `series` such that the title starts with `<series> - ` (hyphen or en dash), `ensureResolved` repeats `nliOriginal` with the rest of the title. It does not retry when the rest is empty or is only a volume label (`כרך`, `ספר` or `חלק` plus one word).

Each wikidata, nli or fuzzy match is checked with `authorGuardRejects` (`_shared/fallback-match.ts`) against the Simania edition author. A rejected match is discarded and resolution falls through to the next path. A rejection is not a provider failure, so it does not keep the edition `pending`.

### Author-name lookups

Author translation in both directions goes through the server-only `authors` and `author_names` tables. `hebrewNames` resolves English names to Hebrew spellings for recommendation hints, and `englishNames` resolves Hebrew names to English spellings for the resolver's author hint. Each reads stored names first and asks Wikidata only when the requested name is absent. A successful Wikidata name is stored; a successful lookup with no name records `wikidata_checked_at` and is retried after 30 days. Provider failures are not stored.

`recordPair` records the Hebrew edition author with the work's first English author only when `nameSoundScore(he, [en]) >= 0.8`. It joins either name to an existing author and merges two author rows when the pair connects them. Successful `link-edition` and operator `applyRepair` calls record pairs, while `npm run authors:seed` populates the tables from existing linked editions.

## Hardcover → Hebrew edition (localize)

1. Wikidata Hebrew label for the Hardcover title and author (`wikidataHebrew`), then NLI (`nliHebrew`).
2. Find that Hebrew title on Simania and keep the closest match above the existing threshold. For a hint of at least two words, when an author was supplied and its Dice agreement with the result author is at least 0.6, a result containing every hint-title word gets a title-score floor of 0.85. Results are ordered by the boosted weighted score, then the original unboosted weighted score, then title similarity after trailing bracketed or parenthesized labels are stripped, then their original search order. A one-word hint always makes a second, title-only search even when the title-plus-author search returned results; the two result lists are combined in search order and deduplicated by numeric Simania ID. This step runs in the browser (`localizeRecommendations` in `public/js/recs.js`, using `public/js/simania.js`): the `recommendations` function returns the step 1 result as `hebrew_hint`, and the browser calls `link-edition` for an accepted match.
   Box-set hint rule: unless the recommendation's English title has a box word (Trilogy, Collection, Box Set, Boxed Set, Omnibus), `localizeRecommendations` strips Hebrew box words from the hint title with `stripHebrewBoxWords` before matching. `matchHebrewBook` drops Simania results that contain a Hebrew box word (`hasHebrewBoxWord`, whole words מארז, טרילוגיית, טרילוגיה, ערכת, סט) unless the searched title itself has one.

   NLI `alternate` hint: when Wikidata supplies the Hebrew title, `recommendations` also asks NLI. If NLI answers with a title that differs after normalization, the hint carries it as `alternate`; an NLI failure leaves the hint unchanged. The browser tries `alternate` only when the main hint title found no Simania book (`match` returned null), using the same author hint and, under the same box-word rule, with box words stripped. A verified match links with source `nli`.

   Duplicate works (`sameBook`): `link-edition` accepts an edition that is linked to a duplicate work of the same book, so a `sameBook` match is not rejected.

   Hardcover Hebrew edition (`hardcoverHebrewEdition`): when no other hint is found, the `recommendations` hint falls back to a Hebrew Hardcover edition of the book, with source and status `hardcover`.
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

### Rematch cached works (`npm run rematch:cached`)

`scripts/rematch-cached.ts` is an operator tool. It retries cached works that have no linked Hebrew edition, because `refresh:all` only handles books in current use.

- **Candidates.** Forward: the `defaultHebrewHint` followed by the browser's `matchHebrewBook`. Reverse, only when forward finds nothing: the author's Hebrew names read directly from `author_names` and combined with the startup-batched Wikidata names, then the author's Simania books, then a match of their original titles (`wikidataOriginals` plus `nliOriginal`) against the work's title with `similarity >= 0.72`.
- **Confirmation.** A candidate is accepted only when `resolveMatch` on that Hebrew edition returns the same work (same Hardcover id or `sameBook`). A candidate linked to another work is skipped, and a provider failure skips the work.
- Every proposal requires author agreement between the Hebrew edition's author and the work's authors through `authorAgreesWithWork`, and `--from` checks that agreement again.
- **Dry run vs `--apply`.** The default run is a read-only dry run. `--apply` links each accepted edition with the `resolveMatch` status, creating the edition row if needed. The dry run's proposal lines include `book_id`, and `--from <file> --apply` links them with one Hardcover request per 50 proposals, without searching again.
- `--hebrew` is a dry run over Hebrew editions without a work, using the current resolver and author agreement; `--hebrew --explain` additionally includes the translator, original-title and English-author sources, Hardcover query results, and the resolver's stopping reason in every Hebrew skip line. Apply its proposals with `--from <file> --apply`. The last-resort `hebrew_dictionary` step was studied on 136 editions: it found 9, with 0 right, 0 wrong and 9 unknown.
- **Startup retry.** A failed author batch at startup is retried twice, 30 seconds apart.
- **Batched helpers.** `wikidataHebrewAuthors` maps many English author names to their Hebrew labels in one request, and `wikidataOriginals` maps many Hebrew titles to original titles in one request. A non-OK or non-JSON response throws `ProviderError`.
- **Initials.** `nameSoundScore` ignores single-letter initials, so "J. R. R. Tolkien" and "Tolkien" compare on the remaining name parts.
- **Dictionary last resort.** Only after every other step produced no proposal and no provider failed, `pickByDictionary` scores the author's unlinked Hebrew books from the reverse step with English Wiktionary glosses. It proposes the unique best candidate only at a score of at least `0.5`, with `via: "dictionary"` and `resolve_status = 'dictionary'`. A Wiktionary failure is a provider failure, not a negative result.

The operator-only sound lookup uses `_shared/author-sound.ts` (`sameAuthor`, `hebrewAuthorBySound`); only operator scripts run it. Names it discovers are stored with source `sound`, while `authors.sound_checked_at` records checks and allows rechecking after 30 days. Its dictionary rule requires both sides to score at least `0.67` and no word to be `contradicted`.

Every `rematch:cached` skip line with `"skipped":"provider_failure"` includes `failures`, with one entry per failed call containing the provider name and an error message truncated to 200 characters.

Before printing a proposal, and again before linking one with `--from ... --apply`, `rematch:cached` applies the NLI English-original guard and skips an established mismatch as `nli_english_mismatch`; an absent or failed NLI result does not reject the proposal.

`npm run measure:links` is a read-only measurement of missed translations among in-use works and makes no Hardcover requests; `--wrong <n>` additionally samples `n` linked in-use works and reports each NLI comparison as `agree`, `differ` or `unknown`. With `--all --sample <n>`, it measures all cached works by sampling the unlinked ones and estimates the missed rate over all works.

`author_books` source: after the other English-side sources give no proposal and no provider failed, `rematch:cached` lists the unlinked Simania books by the work's Hebrew author and reuses `decideMissedTranslation` from `scripts/measure-links.ts`. It bridges each book back through NLI or Wikidata, and an original that matches the English title (similarity of at least 0.6 after the strip) becomes a proposal with `via: "author_books"`. It still passes author agreement and the NLI English-original guard, and `--from ... --apply` accepts these lines. On 2026-11-23, `measure:links --all --sample 400` found 22 confirmed missed translations in its sample that the rematch had not linked, an estimated 97 of 2,971 works.

Provider throttle: the scripts wrap their `fetch` with `scripts/lib/provider-throttle.ts`. `throttledHardcoverFetch` serializes Hardcover requests 1000 ms apart, and `throttledWikimediaFetch` serializes Wikidata, Wiktionary and Wikipedia requests with starts at least 300 ms apart. On HTTP 429 each waits for `Retry-After` (15 s when absent) and retries, up to 5 times for Hardcover and 6 for Wikimedia. All 69 provider failures in the 2026-11-23 `--hebrew` run were rate limits (81 Hardcover 429 errors, 10 Wikidata 429 errors).

Provider retry: `rematch:cached` and `measure:links` call `setProviderRetry` at start, and only the scripts do, so edge functions keep their behavior. With the policy set, an idempotent provider request (Wikidata, NLI, Wiktionary, Simania) that aborts on its timeout or gets HTTP 5xx is retried once after a pause, with a longer timeout. Hardcover is not retried, and HTTP 429 keeps its own handling.

Response cache: `--cache-dir <dir>` stores provider responses on disk for 7 days, so a rerun or another script reuses them. Only idempotent providers are cached; Hardcover requests are never cached.

Concurrency: `rematch:cached --concurrency <n>` takes 1 to 4 works at a time. The throttles still allow one request at a time per host, and the output stays in work order, so a run is comparable with a sequential one.

Run health: `npm run check:run-health -- <file>` reads one `rematch:cached` or `measure:links` output and exits 1 with a one-line reason when the output cannot be trusted: no summary line, more than half provider failures, or any Simania HTTP 403. `rematch-measure.yml` runs it after the hebrew job, each English shard and the measure job, so an unusable run is red while the artifact is still uploaded.

Workflow `.github/workflows/rematch-measure.yml` runs the rematch and measurement on GitHub runners. It is manual (`gh workflow run rematch-measure.yml`) and read-only; it never applies. The jobs run in order: hebrew, then the English shards one at a time, then measure. Results are uploaded as artifacts kept 14 days. It needs the repo secrets `TORIMITOR_DB_PASSWORD`, `HARDCOVER_API_KEY` and `NLI_API_KEY`, plus `TORIMITOR_DB_HOST` if the pooler is used. Applying is still done locally with `--from <file> --apply`, after review.

Hebrew-side guard and dictionary decisions (studies in `docs/reports/2026-11-23-*.md`): the NLI English-original guard stays on `--hebrew` proposals. Of 35 pairs it checked on the Hebrew side, 0 were right, 34 wrong and 1 unknown, so it rejects wrong pairs rather than right ones. There is no `hebrew_dictionary` step in `--hebrew`: the dictionary study over 136 editions checked 38 and found 0 right, 35 wrong and 3 unknown. Its 4 accepted proposals were 0 right, 2 wrong and 2 unknown, short of the bar of at least 3 right and a wrong share below 0.05.

## Normalization

`utils.ts normalize` and `similarity` are authoritative: NFKD, Latin diacritics removed, lower case, a leading English article removed, everything that is not a letter or digit turned into a space. `similarity` is word-set Dice overlap. Display text is never changed. `stripHebrewPoints` runs first in `normalize`: it removes Hebrew points and cantillation marks (U+0591-U+05C7, except maqaf U+05BE, which becomes a space). `nameSoundScore` applies it to Hebrew names too. It exists in the browser (`public/js/simania.js`, `public/js/names.js`) and on the server (`_shared/utils.ts`, `_shared/names.ts`). Hebrew final-letter folding is not implemented; do not add it unless a task asks.

### Browser title-match verification

`verifyTitleMatch` (`public/js/recs.js`) accepts a Simania title match when any of these holds, in order:

1. the recommendation's Hebrew author is similar to the Simania author (`similarity >= 0.6`);
2. the Simania author sounds like the English author (`nameSoundScore >= 0.8`, against each comma-separated English author);
3. the `match-by-author` function confirms the candidate.

## LLM fallback

Deferred. The status value `llm` is reserved.
