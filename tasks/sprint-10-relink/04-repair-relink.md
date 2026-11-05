---
id: S10-T4
stage: 2
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S10-T3
allowed_paths:
  - scripts/repair-links.ts
  - tests/functions/repair-links.test.ts
  - scripts/lib/prod-db.ts
  - tests/functions/prod-db.test.ts
context:
  - contract
  - architecture.data_model
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

`npm run repair:links` also moves a wrongly linked edition to the right Hardcover work when the Simania page proves it. It is dry-run by default and writes only with `--apply`.

# Scope

Contract: "Operator scripts: catalog audit and link repair", **`npm run repair:links`**, the "Relinks" paragraph. In `scripts/repair-links.ts`:

0. `linkedEditionsWithWorks` (`scripts/lib/prod-db.ts`) also returns `w.id as work_id`, the current work's id. Extend its existing test so that it asserts the column.
1. Planning: keep the existing `unlinked` plans unchanged. Add relink plans from `findAuthorMismatches` (S10-T3, `scripts/audit-catalog.ts`) over `linkedEditionsWithWorks`: one per finding whose `proposal.reason` is `ok` and `proposal.book.id !== finding.hardcover_id`. A relink plan carries `kind: "relink"`, the old work id and `hardcover_id`, and the proposal. Existing plans get `kind: "link"`.
2. `applyRepair` for a relink, in one transaction:
   - Upsert the proposed work exactly as the existing link path does.
   - Then `update editions set work_id = <new>, resolve_status = 'original_title', resolved_at = now where simania_id = <id> and work_id = <old work id>`.
   - 0 rows gives `skipped`.
   - Never delete the old work. Never touch `recommendations` or `shelf_books`.
3. The dry-run line for a relink shows `relink`, `simania_id`, Hebrew title, from `hardcover_id` and title, to `hardcover_id` and title, and evidence (English author or sound score). The exit codes stay as they are.

# Tests (add to `tests/functions/repair-links.test.ts`, fakes only)

1. A mismatch with an `ok` proposal for a different book gives a relink plan. A mismatch whose proposal points at the same book, or has another reason, gives none.
2. Relink `applyRepair` with the recording fake `sql`: a work upsert, then an edition update whose condition includes `work_id = <old>` and not `work_id is null`, inside one transaction.
3. A relink update touching 0 rows gives `skipped`.
4. The existing link tests keep passing. Dry-run still opens the database read-only and never calls `applyRepair`.

# Acceptance criteria

1. The behavior above; all tests pass.
