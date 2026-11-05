---
id: S9-T8
stage: 4
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S9-T6
  - S9-T7
allowed_paths:
  - scripts/verify-repair.ts
  - docs/architecture/testing.md
  - docs/architecture/functions.md
context:
  - contract
  - architecture.testing
  - architecture.functions
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - npm run verify:repair
---

# Goal

A live gate proves, read-only against production, that the repair finds the right Hardcover work for each known unlinked translation and nothing for Hebrew originals, and that the audit runs cleanly.

# Scope

1. New `scripts/verify-repair.ts` (`npm run verify:repair` already exists in `package.json`). It uses `planRepairs` and `runAudit` with real providers and a read-only production session (`openProdDb({ readOnly: true })`; it never applies anything). Print one `PASS`/`FAIL` line per case and exit 1 if any case fails; exit 2 on a database or provider failure that prevented the run (print the cause, never secrets). Cases, measured on 2026-11-05:

   | simania_id | Hebrew title | expected |
   |---|---|---|
   | 905132 | מתחת לכיפה השקופה | Hardcover 384966 (Under the Dome) |
   | 1026572 | עוזרת הבית רואה הכול | 994242 (The Housemaid Is Watching) |
   | 1027968 | הקולגה | 872020 (The Coworker) |
   | 1014927 | רק לקיץ הזה | 884117 (Just for the Summer, Abby Jimenez) |
   | 1024649 | מרגו צריכה כסף | 1237058 (Margo's Got Money Troubles) |
   | 1028062 | המדריך למכשפה מהעבר לדייטים מודרניים | 1949170 (An Ancient Witch's Guide to Modern Dating) |
   | 659042 | ואם היו אומרים לך | no proposal (Hebrew original) |
   | 997869 | אף אחד לא עוזב את פאלו אלטו | no proposal (Hebrew original) |
   | 1028464 | תמרה משקרת | no proposal (Hebrew original) |

   An edition that is already linked when the gate runs (for example after the operator applied the repair) passes when its current work's `hardcover_id` equals the expected one; check that with a read-only query. Also run `runAudit` and pass when it completes with the three sections and `author_mismatches` does not contain 97171 (סחרור, correctly linked to Spin).
2. Docs (match what was built): `docs/architecture/testing.md` lists `verify:repair` with the other live gates and says it is read-only against production; `docs/architecture/functions.md` (or the closest place the scripts are described) gets a short "Operator scripts" paragraph about `audit:catalog` and `repair:links --apply`, why they run off-cloud (Simania page blocked for Edge Functions, no CORS for browsers), and that `--apply` only links null `work_id` editions with status `original_title`.

# Acceptance criteria

1. `npm run verify:repair` passes on the current production data; docs updated; nothing applied to production.
