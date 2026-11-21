---
id: S31-T1
stage: 1
model_class: worker
timeout_minutes: 25
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Alternative titles in every match (S31).**','**Box sets (S31).**','**Box-set hints (S31).**','npm run recheck:links','593165','488917','**Genre shelves skip shelved works (S31).**','**NLI alternate hint (S31).**','994102'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes S31: three general rules and an operator recheck of existing links. App code holds no book-, series- or author-specific constants.

Measured on prod on 2026-11-21. A review of all 453 Wikidata/NLI links found wrong ones, three of them on used works:
- **Camus.** 16301 `האדם המורד` is linked to Hardcover 1851773, `La révolte: La peste, Les Justes, L'homme révolté` (1 reader). The search `L'Homme révolté` returns 488917 `The Rebel` by Albert Camus (407 readers) first. Its search document's `alternative_titles` contain `L'Homme révolté`, but its title does not.
- **Box sets.**
  - 980165 `טרילוגיית משחקי הרעב` (a shelved box set) is linked to 88639 `The Hunger Games` (book 1). Hardcover has 593165 `The Hunger Games Trilogy`.
  - 1020813 `מארז דיגיטלי – מורשת הותורן` is linked to 428546 `The Inheritance Games` (book 1). Hardcover has 677935 `The Inheritance Games Collection`.
  - Hardcover's `compilation` flag is unreliable (88639 has `compilation: true`), so it is not used.
- **The box-set hint.** Wikidata's Hebrew label for `The Hunger Games` is `טרילוגיית משחקי הרעב`, so the browser hint for book 1 names the box set.

# Scope

1. In the Hebrew resolution procedure, step 3 (**Hardcover match**), add:
   - **Alternative titles in every match (S31).** Every Hardcover search requests `ids` and `results` in the same single request. A book's title Dice is the maximum of the Dice against its title, its title before the first `:`, and each of its search document's `alternative_titles`. This extends "**Hardcover alternative titles (S30).**" to all matches, including `verify:fallback`. Ranking, thresholds and the tie rule are unchanged. Example: `L'Homme révolté` by Albert Camus gives 488917.
2. After the match title rules, add:
   - **Box sets (S31).** An edition is a box set when its match title contains one of the words `מארז`, `טרילוגיית`, `טרילוגיה`, `ערכת` or `סט`, as a whole word (bounded by start, end, space, `-`, `–`, `(`, `)`, `[` or `]`).
     - For a box set, the bridges run on the **box core**: the match title with those words and the words `מלא`, `דיגיטלי` and `דיגיטלית` removed. Then split it on ` - ` and ` – `, keep the longest part, and trim it.
     - The Hardcover match for a box set tries, in order, `"<bridge title> Trilogy"`, `"<bridge title> Collection"` and `"<bridge title> Box Set"`. It accepts the first book whose title contains `Trilogy`, `Collection`, `Box Set`, `Boxed Set` or `Omnibus` (case-insensitive) and that has author evidence. Title Dice is computed with those words removed from both sides.
     - A box set is never linked to a book without such a word. With no accepted book, it is `not_found`.
     - The direct fuzzy fallback does not run for box sets.
     - Examples: 980165 gives 593165; 1020813 gives 677935.
3. In recommendation localization step 2, add:
   - **Box-set hints (S31).** When the card's English title has none of the English box words above:
     - the browser removes the Hebrew box words from the hint title before searching (`טרילוגיית משחקי הרעב` becomes `משחקי הרעב`);
     - `matchHebrewBook` ignores results whose title has a Hebrew box word when the hint title has none.

     Over the 249 S29 replay cases this changes only `The Hunger Games` (`hardcover_id` 88639), whose current pick is the box set 980165.
4. Under **Operator scripts**, add **`npm run recheck:links`** (`scripts/recheck-links.ts`, S31): rechecks existing automatic links with the current resolver rules.
   - **Scope.** Positive editions with `work_id` set and `resolve_status` `wikidata`, `nli` or `fuzzy`, whose work is used (shelf, recommendation or genre row). With `--all`, every such edition. With `--simania <id>`, one edition.
   - **Check.** For each edition, run the resolver's decision (`resolveMatch`, below) without writing.
     - When it accepts a Hardcover book whose ID differs from the current work's `hardcover_id`, print a `relink` line: `simania_id`, `title`, from `hardcover_id`/`original_title`, to `hardcover_id`/`title`, new `status`.
     - When it accepts nothing for a box set, print an `unlink` line.
     - Otherwise print nothing for the edition.
     - Then print `{ "checked": n, "relinks": n, "unlinks": n }`.
   - **`--apply`.** Relink through `repair:links`' relink transaction, with the new status, only where `work_id` still equals the old work's ID. An unlink sets `work_id` null, `resolve_status` `not_found` and `resolved_at` now, only where `work_id` still equals the old ID. It prints `{ "relinked": n, "unlinked": n, "skipped": n }`.
   - **Hardcover budget.** The same check as `refresh:all` (`--min-hardcover`, default `1500`; `--force-hardcover`; exit `4`). Requests are sequential.
   - **Review.** The operator reviews every line before `--apply`.
   - **`resolveMatch(edition, providers)`.** Exported from the resolver: the full Wikidata → NLI → fuzzy decision with no database write. It returns `{ book, status }` or `null`, with the same provider-failure behavior. `ensureResolved` uses it.
5. In **Genre recommendation shelves**, add:
   - **Genre shelves skip shelved works (S31).** When the browser loads genre shelves, it drops rows whose `work_id` is the `work_id` of any edition on the reader's shelves. Live case: a shelved edition was linked to its work after the genre rows were stored, and the same work then showed on a genre shelf. If that read fails, all rows are kept.
6. In recommendation localization (the `hebrew_hint` paragraph), add:
   - **NLI alternate hint (S31).** When the hint comes from Wikidata, the function also runs the NLI Hebrew lookup. When it gives a different title (after normalization), the hint carries it as `alternate`. When the browser's step 2 match finds no book for the hint title, it tries `alternate` once, with the same verification, and links with `source` `nli`.
     - Live case: Pet Sematary. The Wikidata hint `בית קברות לחיות` finds only a DVD. NLI gives the edition title `בית כברות לחיות`, which is Simania 994102.
     - This adds at most 3 NLI requests per English-only candidate. Update the request bounds accordingly.

Change nothing else.

# Acceptance criteria

1. The text matches the measured cases above; both verification commands pass.
