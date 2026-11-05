---
id: S9-T7
stage: 3
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S9-T1
  - S9-T4
  - S9-T5
allowed_paths:
  - scripts/repair-links.ts
  - tests/functions/repair-links.test.ts
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

`npm run repair:links` links shelved Hebrew translations to their Hardcover work using Simania's original title: dry-run by default, writes only with `--apply`.

# Scope

Contract: "Operator scripts: catalog audit and link repair", **`npm run repair:links`** (the npm script already exists in `package.json`).

New `scripts/repair-links.ts`:
1. Export `planRepairs(deps): Promise<RepairPlan[]>`: for each `shelvedUnlinkedEditions` row, run `proposeLink` sequentially; a plan is a proposal with `reason: "ok"`. Other rows are reported with their reason.
2. Export `applyRepair(sql, plan, now)`: one transaction per edition:
   - Upsert the Hardcover work with the same fields and conflict rule the resolver's `upsertWork` uses (`supabase/functions/_shared/catalog.ts`; mirror its column mapping in SQL).
   - Then `update editions set work_id = <work>, resolve_status = 'original_title', resolved_at = now where simania_id = <id> and work_id is null`.
   - Report `linked`, or `skipped` when the update touched 0 rows (someone linked it meanwhile; never relink).
3. `import.meta.main`: `loadOperatorEnv()`. Without `--apply`, open read-only and print the plan (`simania_id`, Hebrew title, original title, Hardcover id and title, evidence: English author or sound score); exit 0. With `--apply`, open with `readOnly: false`, apply each plan, print results; exit 0 when all applied or skipped, 1 when any transaction failed. Never print secrets. Never touch `recommendations`, `shelf_books` or already linked editions.

# Tests (new `tests/functions/repair-links.test.ts`, fakes only, no database)

1. Planning: fake proposals give plans only for `ok` rows; other reasons are reported.
2. `applyRepair` with a fake `sql` that records statements: a work upsert, then an edition update with `work_id is null` in its condition, inside a transaction.
3. Update touching 0 rows gives `skipped`, not an error.
4. Dry-run mode never calls `applyRepair` and opens the database read-only.

# Acceptance criteria

1. The behavior above; all tests pass.
