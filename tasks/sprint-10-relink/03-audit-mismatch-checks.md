---
id: S10-T3
stage: 1
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - scripts/audit-catalog.ts
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

The audit's `author_mismatches` section stops flagging correctly linked editions and carries a link proposal for each real mismatch.

# Scope

Contract: "Operator scripts: catalog audit and link repair", **`npm run audit:catalog`** item 2. In `scripts/audit-catalog.ts`:

1. Export `findAuthorMismatches(editions, deps): Promise<AuthorMismatchFinding[]>`. It takes the `linkedEditionsWithWorks` rows and the same injectable deps `runAudit` already has (`nameSoundScore`, `wikidataEnglishAuthor`, `similarity`, `proposeLink`).
2. Clear an edition with the first check that holds, in this order:
   - (a) direct `similarity(edition.author, a) > 0.45` for some work author;
   - (b) sound score `>= 0.5`;
   - (c) the Wikidata English author matches;
   - (d) `proposeLink(edition)` is `ok` with `book.id === edition.hardcover_id`.

   Call Wikidata and `proposeLink` only when the earlier checks did not clear the edition. Run them sequentially, as today.
3. A flagged finding keeps every field of its input row, spread in, so a later `work_id` column passes through. S10-T4 relies on this. A flagged finding also gets `proposal` (the `proposeLink` result) and `reason` (`proposal.reason`). A provider error on one edition is recorded on that finding (`error: "provider_error"`) and does not stop the section.
4. `runAudit` uses `findAuthorMismatches`. Text output shows each finding's proposal (Hardcover id and title) or its reason. `--json` includes `proposal`.

# Tests (add to `tests/functions/audit-catalog.test.ts`, fakes only)

Use production data measured on 2026-11-05. Keep the existing tests passing.

1. Not flagged:
   - `Lena Dunham` on a work by `Lena Dunham` (a)
   - `גלית דיסטל אטבריאן` on a work whose authors are `["גלית דיסטל אטבריאן"]` (a)
   - `George Orwell` on a work by `Fido Nesti, George Orwell` (a)
   - `מאט הייג` on 428018 with a fake proposal `ok` for 428018 (d)
2. Flagged with its proposal: `כריסטין האנה` (981260, `הזמיר`) on 1912461 `עת הזמיר` by `Haim Be'er, חיים באר`; fake Wikidata gives `Kristin Hannah`; fake proposal `ok` for 212769 `The Nightingale`.
3. Flagged with reason: a mismatch whose proposal is `no_original_title` is listed with that reason.
4. Order: an edition cleared by (a) never calls Wikidata or `proposeLink` (the fakes record calls).
5. A `proposeLink` that throws on one edition gives `error: "provider_error"` there, and the next edition is still checked.

# Acceptance criteria

1. The behavior above; all tests pass.
