---
id: S39-T5
stage: 4
model_class: worker
timeout_minutes: 40
review: true
depends_on:
  - S39-T3
allowed_paths:
  - scripts/authors-seed.ts
  - scripts/repair-links.ts
  - scripts/lib/link-proposal.ts
  - scripts/rematch-cached.ts
  - package.json
  - tests/functions/authors-seed.test.ts
  - tests/functions/repair-links.test.ts
  - tests/functions/link-proposal.test.ts
  - tests/functions/rematch-cached.test.ts
  - tests/functions/rematch-from-file.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "const p=require('./package.json');if(!/scripts\/authors-seed\.ts/.test(p.scripts['authors:seed']||''))throw new Error('script')"
---

# Goal

Contract: "**Authors table (S39).**" (operator scripts). The operator scripts use the authors table through `sqlAuthorStore`.

# Scope

1. New `scripts/authors-seed.ts`, with `package.json` `"authors:seed": "deno run --allow-net --allow-env --allow-read --allow-sys scripts/authors-seed.ts"`:
   - It reads every linked pair (`editions.author` with the work's `original_authors[1]`, for `simania_id > 0`), and calls `recordPair` for each, sequentially.
   - It is a dry run unless `--apply`; the dry run counts what would be stored using the in-memory logic. The final line is `{"pairs":n,"stored":n,"rejected":n,"authors":n}`.
   - It makes no provider calls.
   - Follow the `recheck-links.ts` structure, with injectable deps.
2. `scripts/repair-links.ts` `applyRepair`: after a successful link or relink, call `recordPair(sqlAuthorStore(tx), plan edition author, the book's first author)`, inside the same transaction.
3. `scripts/lib/link-proposal.ts`: replace `providers.wikidataEnglishAuthor(edition.author)` with `englishNames(store, edition.author)` (first name), where `store` is an injectable dep defaulting to the in-memory store. A provider error keeps the existing `provider_error` reason.
4. `scripts/rematch-cached.ts`:
   - Replace `authorNamesFromLinks`, plus the startup `wikidataHebrewAuthors` batch, with the table. At startup, run `wikidataHebrewAuthors` (S37, retried as in S38) only for the first authors that `find` doesn't know or that have `wikidata_checked_at` older than 30 days.
   - With `--apply`, store its answers (`source: "wikidata"`) and mark them checked. A dry run keeps them in memory.
   - `hebrewNames` for a work then reads the table, plus the in-memory answers.
   - Exit 3 behavior is unchanged.

# Tests

1. `authors-seed`: 3 pairs, one failing the sound check → `stored: 2, rejected: 1`. A dry run writes nothing.
2. `applyRepair` calls `recordPair` with the right names (stub store).
3. `link-proposal` uses the store's English name, with no Wikidata call.
4. `rematch-cached` asks the Wikidata batch only for unknown authors, stores the answers only with `--apply`, and still exits 3 after 3 failed batches.

Existing tests pass. Update them only where the old author map is stubbed.

# Acceptance criteria

1. The behavior above; all verification commands pass.
