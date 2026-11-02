# Title matching

The current implementation in `supabase/functions/_shared/bridges.ts` and `simania.ts` is the baseline. Keep its behavior unless a task says otherwise.

## Hebrew edition → Hardcover (resolve)

1. Wikidata: find a written work by the Hebrew title, read its original or English label and author (`wikidataOriginal`).
2. Look the result up on Hardcover (`findHardcoverBook`); accept only if title and author are close after normalization.
3. If that fails, NLI: read the uniform/original title (MARC 240) for the Hebrew record (`nliOriginal`) and repeat step 2.
4. Nothing accepted: `resolve_status = 'not_found'`, but only when every provider answered. If any provider request failed, keep `pending` so a later request retries.
5. Record which step succeeded in `resolve_status` (`wikidata`, `nli`, `fuzzy`).

## Hardcover → Hebrew edition (localize)

1. Wikidata Hebrew label for the Hardcover title and author (`wikidataHebrew`), then NLI (`nliHebrew`).
2. Find that Hebrew title on Simania and keep the closest match above the existing threshold. This step runs in the browser (`localizeRecommendations` in `public/js/recs.js`, using `public/js/simania.js`): the `recommendations` function returns the step 1 result as `hebrew_hint`, and the browser calls `link-edition` for an accepted match. `matchHebrewBook` in `_shared/simania.ts` remains for off-cloud use.
3. Before calling any provider, check `editions` for a row whose `work_id` is already this work. Reuse it.

## Normalization

`utils.ts normalize` and `similarity` are authoritative: NFKD, Latin diacritics removed, lower case, a leading English article removed, everything that is not a letter or digit turned into a space. `similarity` is word-set Dice overlap. Display text is never changed. Hebrew final-letter folding and niqqud handling are not implemented; do not add them unless a task asks.

## LLM fallback

Deferred. The status value `llm` is reserved.
