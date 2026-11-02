---
id: S4-T6
stage: 3
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S4-T1
  - S4-T4
allowed_paths:
  - scripts/verify-resolution.ts
  - package.json
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run verify:resolution
---

# Goal

A live gate, `npm run verify:resolution`, that proves the real resolver links real problem books correctly, using live Wikidata, NLI and Hardcover and no database. The harness runs it as a stage gate, so resolution changes are verified against the real world, not only against stubs.

# Scope

1. `scripts/verify-resolution.ts` (Deno). It imports the real `ensureResolved` from `supabase/functions/_shared/catalog.ts` and the in-memory `FakeDb` from `tests/functions/helpers/fake-db.ts`, and runs every case below with the real providers (no overrides except `now`). Read `HARDCOVER_API_KEY` from the environment, or from the file named by `BOOKNOOK_ENV_FILE` (a `KEY=value` file, same convention as `scripts/serve-functions.mjs`); never print it.
2. For each case, build a fresh FakeDb with the case's edition row (`resolve_status: "pending"`, `work_id: null`, the exact Simania `title` and `author` below) plus any seed rows, call `ensureResolved`, and check the result. If the result is still `pending` (a provider failed), wait 5 seconds and retry once; still `pending` is a failure reported as "provider failure".
3. Cases (exact Simania strings; expected Hardcover ids verified live in Nov 2026):

   | simania_id | title | author | seed rows | expected |
   |---|---|---|---|---|
   | 1008974 | הדירה בפריז | לוסי פולי | edition 1001027 "רשימת המוזמנים" by "לוסי פולי" linked to a work with `original_authors ["Lucy Foley"]` | status `nli`, hardcover 463025 |
   | 976507 | חפצים חדים (2015) | גיליאן פלין | none | hardcover 130839 |
   | 977114 | ההיסטוריה הסודית [מהדורת מודן - 2015] | דונה טארט | none | hardcover 166849 |
   | 989039 | הנסיכה הקסומה [מהדורת 2018] | ויליאם גולדמן | none | hardcover 283102 |
   | 1028145 | מחר ועוד מחר ועוד מחר [עטיפה חדשה] | גבריאל זווין | none | hardcover 479910 |
   | 956502 | עין החתול [מהדורת 2011] | מרגרט אטווד | none | hardcover 94555 |
   | 1027968 | הקולגה | פרידה מקפדן | none | `not_found` (no source links it; it must never match a wrong book) |

   "hardcover N" means the upserted work's `hardcover_id` is N and the status is `wikidata` or `nli` (any accepted bridge), unless a status is given.
4. Print one line per case (`PASS`/`FAIL`, title, status, hardcover id and title) and exit non-zero if any case fails. Run cases sequentially with a descriptive `User-Agent` (the providers already send one).
5. `package.json`: add the script `"verify:resolution": "deno run --allow-net --allow-env --allow-read scripts/verify-resolution.ts"` and change nothing else.

# Rules

This is the one place, besides the integration gate, where live provider calls are allowed (see `docs/architecture/testing.md`). Unit tests still never call live APIs. Do not change resolver code in this task; if a case fails because of resolver behavior, report it in `OPEN_ISSUES` with the printed output instead of weakening the case.

# Acceptance criteria

1. `npm run verify:resolution` passes all seven cases against the merged code of S4-T1, S4-T2 and S4-T4.
