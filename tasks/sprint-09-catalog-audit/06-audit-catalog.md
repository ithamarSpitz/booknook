---
id: S9-T6
stage: 3
model_class: hard_worker
timeout_minutes: 45
review: true
allow_protected: false
depends_on:
  - S9-T2
  - S9-T4
  - S9-T5
allowed_paths:
  - scripts/audit-catalog.ts
  - scripts/lib/localize-chain.ts
  - scripts/verify-localization.ts
  - tests/functions/audit-catalog.test.ts
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

`npm run audit:catalog` prints, read-only, the catalog problems a human should know about: English-only recommendations that have a Hebrew edition, editions linked to a work by a different author, and shelved translations that are still unlinked.

# Scope

Contract: "Operator scripts: catalog audit and link repair", **`npm run audit:catalog`** (the npm script already exists in `package.json`).

1. Move the browser-path localization chain (`localizeChain` and the deps it needs) from `scripts/verify-localization.ts` into a new `scripts/lib/localize-chain.ts`, exported and unchanged in behavior. `scripts/verify-localization.ts` imports it from there (its cases and output stay the same).
2. New `scripts/audit-catalog.ts`:
   - Export `runAudit(deps): Promise<AuditReport>` with injectable deps: the three query helpers from `scripts/lib/prod-db.ts`, `localize` (default: the moved chain, run with a fresh `FakeDb` per recommendation exactly as the localization gate does, so nothing is written to production), `proposeLink` (`scripts/lib/link-proposal.ts`), `wikidataEnglishAuthor`, `nameSoundScore` and `similarity`.
   - Sections exactly as the contract (`english_only_with_hebrew`, `author_mismatches`, `unlinked`). A provider failure on one item is recorded on that item (`error`) and does not stop the section. A database failure stops the run.
   - `import.meta.main`: `loadOperatorEnv()`, `openProdDb({ readOnly: true })`, run, print readable text (default) or one JSON object (`--json`), `sql.end()`, exit 0. A database failure or a failure that prevented a whole section: message on stderr, exit 2. Never print secrets.
   - Run the provider calls for the recommendations sequentially (Simania and Wikidata rate limits).

# Tests (new `tests/functions/audit-catalog.test.ts`, fakes only)

1. `english_only_with_hebrew`: one recommendation whose fake `localize` finds 97171 is listed with it; one that finds nothing is not listed.
2. `author_mismatches`: an edition by `טוני קפ` linked to Aurora by Kim Stanley Robinson (fake Wikidata gives `Tony Kepp`) is flagged; `סטיבן קינג` linked to a Stephen King work is not flagged; a Hebrew name with no Wikidata entry but a sound match of at least 0.5 is not flagged.
3. `unlinked`: each shelved unlinked edition appears with its proposal or reason.
4. A provider error on one recommendation is recorded and the others still run.
5. `--json` output parses and has the three keys.

# Acceptance criteria

1. The behavior above; all tests pass; `npm run verify:localization` behaves as before (the stage check runs it).
