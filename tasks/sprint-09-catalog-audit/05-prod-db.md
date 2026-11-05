---
id: S9-T5
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S9-T1
allowed_paths:
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

Operator scripts can open a production database session from the secrets file, read-only by default.

# Scope

Contract: "Operator scripts: catalog audit and link repair" (first paragraph). New `scripts/lib/prod-db.ts`:

1. `readEnvFile(path): Record<string, string>`: `KEY=value` lines, `#` comments and blank lines ignored, surrounding single or double quotes stripped (the Hardcover key in the real file is quoted). Same parsing rules as `parseEnvValue` in `scripts/verify-localization.ts`.
2. `loadOperatorEnv()`: reads `BOOKNOOK_ENV_FILE`; sets `HARDCOVER_API_KEY` in `Deno.env` when it is missing there; returns `{ dbPassword }` from `TORIMITOR_DB_PASSWORD`. A missing file or value throws an `Error` whose message names the missing key and **never contains a secret value**.
3. `openProdDb({ readOnly = true } = {})`: `npm:postgres@3.4.5` client with host `aws-1-eu-central-1.pooler.supabase.com`, port 5432, user `postgres.zheosjpootcwvuazwjzh`, database `postgres`, `ssl: "require"`, `max: 1`. When `readOnly`, run `set default_transaction_read_only = on` before returning. Returns the `postgres` `sql` object (callers end it with `sql.end()`).
4. Query helpers on a `sql` object, each one SQL statement:
   - `shelvedUnlinkedEditions(sql)`: distinct positive `editions` on any `shelf_books` row with null `work_id` (`simania_id`, `title`, `author`, `translator`), ordered by `simania_id`.
   - `linkedEditionsWithWorks(sql)`: positive editions with a `work_id`, joined to `works` (`simania_id`, `title`, `author`, `hardcover_id`, `original_title`, `original_authors`).
   - `englishOnlyRecommendations(sql)`: non-dismissed `recommendations` with null `simania_id`, joined to `works` and `profiles` (`display_name`, `work_id`, `hardcover_id`, `original_title`, `original_authors`).

   Check the real column names in `supabase/migrations/` and the contract; `recommendations` dismissal is the column the contract defines.

The scripts that use this run with `deno run --allow-net --allow-env --allow-read --allow-sys`. Tests do not connect to any database.

# Tests (new `tests/functions/prod-db.test.ts`)

`readEnvFile` on a temp file (quotes stripped, comments ignored, `=` inside a value kept); `loadOperatorEnv` with a temp file sets `HARDCOVER_API_KEY` only when missing and returns the password; a missing key throws a message that names the key but not any value from the file. The query helpers are exercised with a fake tagged-template `sql` that records the SQL text: assert each helper sends one statement mentioning its tables.

# Acceptance criteria

1. The behavior above; all tests pass.
