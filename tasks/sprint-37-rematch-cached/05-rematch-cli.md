---
id: S37-T5
stage: 4
model_class: worker
timeout_minutes: 40
review: true
depends_on:
  - S37-T4
allowed_paths:
  - scripts/rematch-cached.ts
  - package.json
  - tests/functions/rematch-cached.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "const p=require('./package.json');if(!/scripts\/rematch-cached\.ts/.test(p.scripts['rematch:cached']||''))throw new Error('script')"
---

# Goal

Contract: "**Rematch cached works (S37).**" (CLI part). Add the operator job `npm run rematch:cached -- [--apply] [--hardcover-id <id>] [--offset <n>] [--limit <n>] [--min-hardcover <n>] [--force-hardcover]`. Follow `scripts/recheck-links.ts` for the structure, exit codes, injectable `RunDeps`, read-only database in a dry run, and the Hardcover budget check (default minimum 1500).

# Scope

1. `package.json`: add `"rematch:cached": "deno run --allow-net --allow-env --allow-read --allow-write --allow-sys scripts/rematch-cached.ts"`.
2. `scripts/rematch-cached.ts`:
   - **Works.** These are works with no edition where `simania_id > 0` points to them, ordered by `id`, with `--offset` and `--limit` applied. `--hardcover-id` selects one work.
   - **Startup, once:**
     - Read the link pairs (an edition's `author` and its work's `original_authors[1]`, for `simania_id > 0` editions with both set) and build `authorNamesFromLinks`.
     - Read the set of linked Simania ids.
     - Call `wikidataHebrewAuthors` once for the distinct first authors of the selected works that have no link name. If it throws, log `{"error":"wikidata_authors"}` and exit 3, because a Wikidata failure must not become "no Hebrew name".
   - **Deps for `findCandidates`:**
     - `hebrewHint` is `defaultHebrewHint` (`supabase/functions/recommendations/index.ts`), with a `HardcoverBook` built from the work: id, title, and contributors from `original_authors`.
     - `matchHebrewBook` comes from `public/js/simania.js`, and gives the Simania id of its result.
     - `hebrewNames` gives the link names, otherwise the Wikidata names.
     - `searchBooks` comes from `_shared/simania.ts`.
     - `originals(title, name)` is the union of `wikidataOriginals([title])` and `nliOriginal(title, name)`. Errors are thrown, and results are cached per title.
   - **Per work, sequentially:**
     - Run `findCandidates`.
     - For each candidate, build its `EditionRow` from the database when the row exists, otherwise from `fetchEditionDetails`. A dry run writes nothing.
     - Run `confirmCandidate`, with `resolveMatch(serviceCatalogDb(sql), edition)`, and stop at the first accepted candidate. A candidate whose edition is already linked to a work is skipped as `linked_elsewhere`.
     - Log one JSON line per work, with `hardcover_id`, `title`, and either a `proposal` (`simania_id`, `hebrew_title`, `via`, `status`) or `skipped`: `no_candidate`, `rejected`, `provider_failure` (when anything failed and nothing was accepted), or `linked_elsewhere`.
     - Every 50 works, re-check `hardcoverDailyRemaining`. Below the minimum, without `--force-hardcover`, log a stop line and exit 4. Lines already printed (and links already applied) stay.
   - **`--apply`, for each proposal, right after its line:**
     - When the edition row doesn't exist, insert it from `fetchEditionDetails` with `resolve_status` `pending` (`on conflict (simania_id) do nothing`).
     - For a search-document book (`isSearchDocumentBook`), fetch `hardcoverBooks([id])` first. On failure, log `skipped: "details_failure"`, as `recheck-links` does.
     - Link with `applyRepair` (`kind: "link"`), using the confirmed status. It only links an edition whose `work_id` is still null.
   - **Final line:** `{"works":n,"proposals":n,"linked":n,"skipped":{<reason>:count}}`.

# Tests

New `tests/functions/rematch-cached.test.ts`, with every dependency injected and no database or network:
1. `--hardcover-id 325603` with one forward candidate confirmed → one proposal line and a final line with `proposals: 1`. In a dry run, `applyRepair` and the insert are never called.
2. The same with `--apply` and no existing edition row → the insert runs, then `applyRepair` with status `wikidata`.
3. A search-document book whose details fetch fails → `details_failure`, and `applyRepair` is not called.
4. `wikidataHebrewAuthors` throws → exit 3, with no work processed.
5. The budget drops below the minimum at the 50-work check → exit 4.
6. A candidate rejected by `confirmCandidate` → `skipped: "rejected"`. A failed one → `provider_failure`.
7. An unknown argument → the usage line and exit 2.

Existing tests pass.

# Acceptance criteria

1. The behavior above; all verification commands pass.
