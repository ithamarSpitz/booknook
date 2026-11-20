# Title matching

The current implementation in `supabase/functions/_shared/bridges.ts` and `simania.ts` is the baseline. Keep its behavior unless a task says otherwise.

## Hebrew edition → Hardcover (resolve)

1. Wikidata: find a written work by the Hebrew title, read its original or English label and author (`wikidataOriginal`).
2. Look the result up on Hardcover (`findHardcoverBook`); accept only if title and author are close after normalization.
3. If that fails, NLI: read the uniform/original title (MARC 240) for the Hebrew record (`nliOriginal`) and repeat step 2. Search NLI by title and author surname first, then by title alone. NLI creators are Hebrew, so the Hardcover author hint is the English author of another linked edition by the same Simania author, when one exists.
4. Nothing accepted: `resolve_status = 'not_found'`, but only when every provider answered. If any provider request failed, keep `pending` so a later request retries.
5. Record which step succeeded in `resolve_status` (`wikidata`, `nli`, `fuzzy`).

Each wikidata, nli or fuzzy match is checked with `authorGuardRejects` (`_shared/fallback-match.ts`) against the Simania edition author. A rejected match is discarded and resolution falls through to the next path. A rejection is not a provider failure, so it does not keep the edition `pending`.

## Hardcover → Hebrew edition (localize)

1. Wikidata Hebrew label for the Hardcover title and author (`wikidataHebrew`), then NLI (`nliHebrew`).
2. Find that Hebrew title on Simania and keep the closest match above the existing threshold. This step runs in the browser (`localizeRecommendations` in `public/js/recs.js`, using `public/js/simania.js`): the `recommendations` function returns the step 1 result as `hebrew_hint`, and the browser calls `link-edition` for an accepted match. `matchHebrewBook` in `_shared/simania.ts` remains for off-cloud use.
3. Before calling any provider, check `editions` for a row whose `work_id` is already this work. Reuse it.

4. Fallback, only when steps 1-2 and the author path missed: `hebrew-candidates` lists the author's Hebrew editions from NLI (searched by Latin authority name) with the rule that ties each one to this work. The browser accepts one only with Simania title and author agreement, or with matching character names, and only as a single clear winner. It links with `resolve_status = 'nli_author'` and never relinks. See `docs/contract.md`, "Catalog fallback for English-only books".

## Normalization

`utils.ts normalize` and `similarity` are authoritative: NFKD, Latin diacritics removed, lower case, a leading English article removed, everything that is not a letter or digit turned into a space. `similarity` is word-set Dice overlap. Display text is never changed. `stripHebrewPoints` runs first in `normalize`: it removes Hebrew points and cantillation marks (U+0591-U+05C7, except maqaf U+05BE, which becomes a space). `nameSoundScore` applies it to Hebrew names too. It exists in the browser (`public/js/simania.js`, `public/js/names.js`) and on the server (`_shared/utils.ts`, `_shared/names.ts`). Hebrew final-letter folding is not implemented; do not add it unless a task asks.

### Browser title-match verification

`verifyTitleMatch` (`public/js/recs.js`) accepts a Simania title match when any of these holds, in order:

1. the recommendation's Hebrew author is similar to the Simania author (`similarity >= 0.6`);
2. the Simania author sounds like the English author (`nameSoundScore >= 0.8`, against each comma-separated English author);
3. the `match-by-author` function confirms the candidate.

## LLM fallback

Deferred. The status value `llm` is reserved.
