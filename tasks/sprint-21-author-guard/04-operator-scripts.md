---
id: S21-T4
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S21-T1
allowed_paths:
  - scripts/refresh-all.ts
  - scripts/unlink-fallback.ts
  - tests/functions/refresh-all.test.ts
  - tests/functions/unlink-fallback.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

The operator can see exactly which book failed during `refresh:all`, and why. They can also unlink one wrong edition, whatever its link source, after review.

# Scope

Contract: "`npm run refresh:all`", "Failure details (S21)", and the `--any-status` sentence in the "`npm run audit:authors`" paragraph.

1. `scripts/refresh-all.ts`:
   - every failed book prints the `{ "failed": { title, step, function, status, message } }` line, with the redaction and 200-character cut;
   - no stack traces on stdout;
   - totals are unchanged;
   - never print keys, tokens or emails other than as today.
2. `scripts/unlink-fallback.ts`:
   - `--apply --simania <id> --any-status` unlinks that one edition whatever its `resolve_status`, in the same transaction and with the same row updates as today;
   - without `--any-status` the `nli_author` restriction stays;
   - `--any-status` without `--simania` is an error (exit 2) and changes nothing.

# Tests

1. `refresh-all.test.ts`:
   - a failing `link-edition` call (status 409) prints one `failed` line with the title, `step: "localize"`, `function: "link-edition"` and `status: 409`;
   - a message containing `eyJabc.def.ghi` is redacted.
2. `unlink-fallback.test.ts`:
   - `--simania 2970 --any-status` on a `wikidata` edition unlinks it;
   - without the flag it is refused, as today;
   - `--any-status` alone exits 2 and writes nothing.
3. Existing tests pass.

# Acceptance criteria

1. The behavior above; `check:functions` and `test:functions` pass.
