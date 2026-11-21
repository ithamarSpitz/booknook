# Title matching

The current implementation in `supabase/functions/_shared/bridges.ts` and `simania.ts` is the baseline. Keep its behavior unless a task says otherwise.

## Hebrew edition → Hardcover (resolve)

Before any provider lookup, `matchTitle` (`_shared/catalog.ts`) strips trailing edition labels from the Simania title: trailing `[...]` or `(...)` groups, and a final ` - ` or ` – ` suffix only when that suffix contains an edition word (מהדורה, מהדורת, עטיפת, כריכה, הדפסה, כרכים). It repeats until nothing more is removed and returns the trimmed original if the result would be empty. The stripped title is used for matching only; the stored edition title is unchanged.

1. Wikidata: find a written work by the Hebrew title, read its original or English label and author (`wikidataOriginal`).
2. Look the result up on Hardcover (`findHardcoverBook`); accept only if title and author are close after normalization.
3. If that fails, NLI: read the uniform/original title for the Hebrew record (`nliOriginal`) and repeat step 2. The record's Hebrew title is matched against the full MARC 245 title, 245 `a` alone, and each Hebrew 246 title; the best of those three match types counts. Candidates come from MARC 240, 130 and 765; after those, a 246 whose `i` starts with `Title page verso` supplies a Latin `a` title only when MARC 041 has an `h` value other than `heb`. A Latin `b` on that 246 supplies the `versoAuthor` hint. Search NLI by title and author surname first, then by title alone. NLI creators are Hebrew, so the Hardcover author hints are tried in this order: the English author of another linked edition by the same Simania author, when one exists; `versoAuthor`; the Wikidata English author bridge; then the NLI creator.
4. Nothing accepted: `resolve_status = 'not_found'`, but only when every provider answered. If any provider request failed, keep `pending` so a later request retries.
5. Record which step succeeded in `resolve_status` (`wikidata`, `nli`, `fuzzy`).

`findHardcoverBook` takes two options besides `requireAuthor` (`_shared/hardcover.ts`):

- `retryWithAuthor`: when the title-only search yields no accepted match and the author hint contains a Latin letter, search again with `<title> <author>` and rank that result list. Title Dice there is the best of the full Hardcover title, the part before the first `:`, and the book's `alternative_titles`, and the retry requires an author boost.
- `soundAuthor`: a Hebrew author name. A candidate whose authors have `nameSoundScore(soundAuthor, authors) >= 0.6` gets the same author boost as a similar English author hint.

`ensureResolved` (`_shared/catalog.ts`) passes `retryWithAuthor: true` on the Wikidata and NLI paths. On the NLI path it adds `soundAuthor` (the edition's Hebrew author) only when no English author hint was found. The final fuzzy path uses `requireAuthor` only.

Series-prefix NLI retry: when the NLI lookup of the full title finds nothing and the edition has a `series` such that the title starts with `<series> - ` (hyphen or en dash), `ensureResolved` repeats `nliOriginal` with the rest of the title. It does not retry when the rest is empty or is only a volume label (`כרך`, `ספר` or `חלק` plus one word).

Each wikidata, nli or fuzzy match is checked with `authorGuardRejects` (`_shared/fallback-match.ts`) against the Simania edition author. A rejected match is discarded and resolution falls through to the next path. A rejection is not a provider failure, so it does not keep the edition `pending`.

## Hardcover → Hebrew edition (localize)

1. Wikidata Hebrew label for the Hardcover title and author (`wikidataHebrew`), then NLI (`nliHebrew`).
2. Find that Hebrew title on Simania and keep the closest match above the existing threshold. For a hint of at least two words, when an author was supplied and its Dice agreement with the result author is at least 0.6, a result containing every hint-title word gets a title-score floor of 0.85. Results are ordered by the boosted weighted score, then the original unboosted weighted score, then title similarity after trailing bracketed or parenthesized labels are stripped, then their original search order. A one-word hint always makes a second, title-only search even when the title-plus-author search returned results; the two result lists are combined in search order and deduplicated by numeric Simania ID. This step runs in the browser (`localizeRecommendations` in `public/js/recs.js`, using `public/js/simania.js`): the `recommendations` function returns the step 1 result as `hebrew_hint`, and the browser calls `link-edition` for an accepted match.
3. Before calling any provider, check `editions` for a row whose `work_id` is already this work. Reuse it.

`tests/web/match-replay.test.mjs` replays captured Simania result sets and guards the matcher picks that equal the production links.

4. Fallback, only when steps 1-2 and the author path missed: `hebrew-candidates` lists the author's Hebrew editions from NLI (searched by Latin authority name) with the rule that ties each one to this work. The browser accepts one only with Simania title and author agreement, or with matching character names, and only as a single clear winner. It links with `resolve_status = 'nli_author'` and never relinks. See `docs/contract.md`, "Catalog fallback for English-only books".

5. Omnibus, only when step 2 found no title match (`localizeRecommendations`). `matchOmnibus(hintTitle, results)` (`public/js/simania.js`, pure) looks at a Simania search for the hint title (6 results). A result counts when its `subtitle` splits on ` | ` into at least 2 parts and some part has `similarity >= 0.9` with the hint title. It returns the result only when exactly one result counts, otherwise null. The browser also requires author agreement: `similarity(hebrew_author, result author) >= 0.6` when the recommendation has a Hebrew author, otherwise `nameSoundScore(result author, English authors) >= 0.8`. A search failure leaves the card unchanged and the author path continues. The link gets `resolve_status = 'omnibus'`. `npm run report:omnibus` lists these links.

## Normalization

`utils.ts normalize` and `similarity` are authoritative: NFKD, Latin diacritics removed, lower case, a leading English article removed, everything that is not a letter or digit turned into a space. `similarity` is word-set Dice overlap. Display text is never changed. `stripHebrewPoints` runs first in `normalize`: it removes Hebrew points and cantillation marks (U+0591-U+05C7, except maqaf U+05BE, which becomes a space). `nameSoundScore` applies it to Hebrew names too. It exists in the browser (`public/js/simania.js`, `public/js/names.js`) and on the server (`_shared/utils.ts`, `_shared/names.ts`). Hebrew final-letter folding is not implemented; do not add it unless a task asks.

### Browser title-match verification

`verifyTitleMatch` (`public/js/recs.js`) accepts a Simania title match when any of these holds, in order:

1. the recommendation's Hebrew author is similar to the Simania author (`similarity >= 0.6`);
2. the Simania author sounds like the English author (`nameSoundScore >= 0.8`, against each comma-separated English author);
3. the `match-by-author` function confirms the candidate.

## LLM fallback

Deferred. The status value `llm` is reserved.
