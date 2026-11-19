---
id: S18-T2
stage: 1
model_class: worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - scripts/verify-fallback.ts
  - scripts/lib/fallback-compare.ts
  - tests/functions/fallback-compare.test.ts
context:
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

The operator can prove that a change to the catalog fallback loses no correct link. They replay the fallback for every already-linked book, compare runs from before and after a change, and rate-limited books are retried instead of left unchecked.

# Scope

The spec is below; S18-T1 writes the same text into `docs/contract.md` ("No-regression tools (S18)"), in parallel with this task.

1. **429 retry (all modes).** In `scripts/verify-fallback.ts`, when a book's decision ends with a provider error containing `Wikidata HTTP 429`, wait 30 seconds and run that book again, up to 3 times. Print only the last result. Inject the wait so tests do not sleep.
2. **`--replay-linked`.**
   - Read-only (`openProdDb({ readOnly: true })`). Select every work that has a linked edition with `simania_id > 0` and is used by any reader: an edition on `shelf_books`, or a work in `recommendations` or `genre_recommendations`.
   - For each work, run exactly the decision `--population` runs (the same `populationDecision` path), as if the work were English-only. Use the work's `original_title` and first `original_authors` entry.
   - Print one JSON line per work: `hardcover_id`, `title`, `author`, `linked` (array of `{ simania_id, resolve_status }`), `simania_id` (decided or null), `rule`, `rule_g` when present, and `errors` when present. Then one totals line: `works`, `decided`, `same_as_linked`, `different_from_linked`, `none`, `errors`.
   - 1 second between works, as in `--population`. Nothing is written anywhere.
3. **`--compare <before> <after> [--keep <file>]`.**
   - Put the pure logic in a new `scripts/lib/fallback-compare.ts`; the CLI only reads the files.
   - It reads two JSONL outputs of the same mode and ignores the totals lines.
   - Key: `hardcover_id` when present (replay), otherwise `title` + `author` (population).
   - It prints one line `{ key, before, after }` (each `{ simania_id, rule }`) for every key whose decided `simania_id` or `rule` differs, and lists keys present in only one file.
   - Keys with `errors` in either file go to an `unverified` list and are not counted as changes.
   - Then a counts line.
   - Exit `1` when any key is a **lost link**, otherwise `0`. A lost link is a key that before decided an ID that is in its own `linked` IDs (replay), or whose key is listed in `--keep` (one key per line: replay keys are hardcover IDs, population keys are `title|author`), and after decides a different ID or none.
4. **Known cases.** Add to `GUARD_CASES` (must not decide):
   - The Folk of the Faraway Tree (Enid Blyton) must not decide 103718;
   - North Woods (Daniel Mason) must not decide 223491.
   They follow the existing `{ title, author, forbidden }` pattern: `{ title: "The Folk of the Faraway Tree", author: "Enid Blyton", forbidden: 103718 }` and `{ title: "North Woods", author: "Daniel Mason", forbidden: 223491 }` (Hardcover 764025 and 880950).
5. Do not change the fallback decision itself (`public/js/recs.js`, `supabase/functions/**`); other S18 tasks do that.

# Tests (new `tests/functions/fallback-compare.test.ts`)

1. Identical files give no changes and exit 0.
2. A replay key whose before decision equals a linked ID and whose after decision is none is a lost link (exit 1); the same change on a key whose before decision was not linked is a change, not a loss (exit 0).
3. A population key listed in `--keep` that changes is a loss.
4. Keys with `errors` go to `unverified`.
5. Keys present in only one file are listed.
6. The 429 retry runs a book again at most 3 times and prints only the last result. Test it with an injected decision function and wait, if the script's structure allows a unit test. If not, test it with a small exported helper.

# Acceptance criteria

1. The behavior above; `check:functions` and `test:functions` pass.
