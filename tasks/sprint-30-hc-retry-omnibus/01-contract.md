---
id: S30-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Hardcover author retry (S30).**','**Hebrew author sound (S30).**','**Series prefix (S30).**','**Omnibus volumes (S30).**','report:omnibus','omnibus','52808','1026206'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes S30. Each rule applies only where the existing path finds nothing, so no edition or link that resolves today changes.

Measured on prod on 2026-11-21. For every case below, NLI already gives the right English title; the Hardcover match or the Simania match then fails:
- **Wild** (Simania 975634, NLI `Wild`, Wikidata author `Cheryl Strayed`). The title search `Wild` returns 8 other books called Wild. `Wild Cheryl Strayed` returns 52808, `Wild: From Lost to Found on the Pacific Crest Trail` by Cheryl Strayed, with 1259 readers.
- **Night School** (962748, Wikidata author `CJ Daugherty`). `Night School CJ Daugherty` returns 61420 first.
- **Survive** (965036, author `אלכס מורל`) and **Regeneration** (145387, author `פאט (פט) בארקר (ברקר)`). The Wikidata author bridge finds no English name, so the hint is the Hebrew NLI creator. That gets no author boost, and same-title books by other authors make the match ambiguous. `nameSoundScore` (in `_shared/names.ts`) gives `0.67` for `אלכס מורל` against `Alex Morel` and `0.63` for the Simania author against `Pat Barker`. It gives at most `0.36` against the other authors in these results, for example `0.00` for `Julie E. Czerneda`.
- **Wither** (960547, `הגן הכימי - הקמילה`, Simania series `הגן הכימי`). NLI finds `הקמילה`, not the full title.
- **All Systems Red.** The hint is `כשל מערכות` with no Hebrew author. The only Hebrew edition is Simania 1026206, `יומני רובורצח - כרך 1` by `מרתה וולס`, subtitle `כשל מערכות | התנייה מלאכותית`: one volume that holds two books.

# Scope

1. In the **Hebrew resolution procedure** (book-details), step 3 **Hardcover match**, add these paragraphs:
   - **Hardcover author retry (S30).** Only in the Wikidata and NLI bridge matches, never in the direct fuzzy fallback.
     - When the match returns no book and the author hint has a Latin letter, make one more match. The search query is `"<English title> <author hint>"`, and it needs author evidence (a contributor with Dice greater than `0.45` with the hint).
     - In this retry only, a book's title Dice is the maximum of the Dice against its full Hardcover title and against the part before the first `:` (trimmed).
     - Ranking, the `0.5` title threshold and the tie rule are otherwise unchanged.
     - Examples: Wild gives 52808; Night School gives 61420.
   - **Hebrew author sound (S30).** Only in the NLI bridge match. When no Latin hint was found (no catalog hint, `verso author` or Wikidata author), the hint is still the NLI creator, as before. In addition, a book gets the author boost when `nameSoundScore(<Simania author>, <its contributor names>)` is at least `0.6`.
     - The first match and the S30 retry both use this. The retry runs only when the hint has a Latin letter, so here it does not run.
     - Examples: Survive gives Alex Morel's 105197; Regeneration gives Pat Barker's 435858.
   - Update the provider request bound: 8 Wikidata, 4 NLI, and at most five two-request Hardcover matches (bridge match plus retry for Wikidata and NLI, and the fuzzy match), 22 in total.
2. In step 2 (**NLI fallback bridge**), add:
   - **Series prefix (S30).** When the NLI bridge finds no original title for the match title, and the edition's `series` (trimmed) is non-empty, and the match title starts with that series followed by ` - ` or ` – `, run the NLI bridge once more with the rest of the title (trimmed).
     - Skip this when the rest is empty or matches `/^(כרך|ספר|חלק)\s*\S+$/`.
     - Example: `הגן הכימי - הקמילה` with series `הגן הכימי ` retries with `הקמילה`.
     - `יומני רובורצח - כרך 1` never retries.
3. In recommendation localization, after the title match and verification (step 2) and before the author path, add:
   - **Omnibus volumes (S30).** The browser runs this only when the step 2 title match returned no book (not when a book failed verification), and only when the hint has a title. It makes one Simania search for the hint title alone, `limit=6`, and runs `matchOmnibus(hint title, results)` (`public/js/simania.js`). That function:
     - splits each result's `subtitle` on ` | ` (a pipe with a space on each side) only when it has at least 2 non-empty parts;
     - counts a result when one part, after the file's normalization, has `similarity` at least `0.9` with the hint title;
     - returns that result only when exactly one result counts, else `null`.
   - The returned book is linked only when its author agrees: `similarity(hebrew_author, author) >= 0.6` when `hebrew_author` is set, else `nameSoundScore(author, English authors) >= 0.8`. Then the existing author guard and `link-edition` run as for any match, with `source` `omnibus`.
   - Example: All Systems Red links to 1026206 (`nameSoundScore("מרתה וולס", ["Martha Wells"])` is `1`).
   - Volume 2 (1027891) is not linked by this rule. Over the 249 S29 replay cases, `matchOmnibus` returns a book only for All Systems Red.
4. Add `omnibus` to the `resolve_status` / `ResolveStatus` values in **Shared values** (add `nli_author` there too if it is missing). `link-edition` accepts `source` `omnibus` and stores it as `resolve_status`, like `nli_author`.
5. Under **Operator scripts**, add:
   - **`npm run report:omnibus`** (`scripts/report-omnibus.ts`, S30): read-only. It prints one JSON line per edition with `resolve_status` `omnibus`, ordered by `resolved_at`. Each line has `simania_id`, `title`, `author`, `series`, `work_id`, `hardcover_id`, `original_title`, `original_authors` and `resolved_at` (edition columns plus the linked work's columns). Then it prints `{ "total": n }`. The operator reviews every line after each refresh.
6. In **`npm run requeue:not-found`**, `--simania <id>` now selects that edition when it is `not_found` with no `work_id`, even when no shelf or recommendation references it. Without `--simania`, nothing changes.

Change nothing else.
