---
id: S38-T2
stage: 2
model_class: worker
timeout_minutes: 40
review: true
depends_on:
  - S38-T1
allowed_paths:
  - scripts/rematch-cached.ts
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
---

# Goal

Contract: "**Rematch apply from a dry run (S38).**". `scripts/rematch-cached.ts` (S37) can apply a saved dry run with almost no provider calls, and it survives one failed Wikidata author batch.

# Scope

1. Each proposal line's `proposal` object also has `book_id: <confirmed book id>`. All other fields stay as they are.
2. At startup, when `deps.wikidataHebrewAuthors` throws, call `deps.sleep(30000)` and retry, for at most 3 attempts in total. Only after the third failure, log `{"error":"wikidata_authors"}` and exit 3.
3. New option `--from <path>`:
   - It is a usage error (exit 2) without a path, or together with `--hardcover-id`, `--offset`, or `--limit`.
   - Read the file through an injectable `deps.readTextFile` (default `Deno.readTextFile`). Parse each line as JSON, ignore lines that fail to parse, and keep objects whose `proposal` has numeric `simania_id` and `book_id` and a `status` of `wikidata`, `nli`, or `fuzzy`.
   - In this mode, never call `findCandidates`, `confirmCandidate`, `resolveMatch`, `wikidataHebrewAuthors`, `wikidataOriginals`, `nliOriginal`, `searchBooks`, `matchHebrewBook`, or the hint.
   - Fetch `deps.hardcoverBooks` for the distinct `book_id`s, in chunks of at most 50 ids per call. A thrown chunk marks its proposals `details_failure`, and so does an id missing from the answer.
   - For each proposal, in file order:
     - `loadEdition`. If the edition has a `work_id`, log `skipped: "linked_elsewhere"`.
     - Otherwise, when the row is missing, build it from `fetchEditionDetails`.
     - With `--apply`: insert a missing row (`on conflict do nothing`), then `applyRepair` (`kind: "link"`) with the fetched book and the saved status, as S37 does. Without `--apply`, write nothing.
     - Log one line `{ simania_id, book_id, hebrew_title, action: "link" | "would_link" }`, or the skip reason.
   - The final line is `{"proposals":n,"linked":n,"skipped":{...}}`. The Hardcover budget check runs once at startup, as before.

# Tests

Add to `tests/functions/rematch-cached.test.ts` or a new `tests/functions/rematch-from-file.test.ts`, with everything injected:
1. A dry-run proposal line includes `book_id`.
2. `wikidataHebrewAuthors` fails twice and then succeeds → `sleep(30000)` is called twice and the run continues. Three failures → exit 3.
3. `--from` with a 3-line file (one proposal, one `skipped` line, one non-JSON line) and `--apply` → exactly one `hardcoverBooks` call with `[book_id]`, one `applyRepair`, and no `resolveMatch` or `findCandidates` call (counters).
4. 120 proposals → `hardcoverBooks` is called 3 times (50, 50, 20).
5. An edition already linked → `linked_elsewhere`, and no `applyRepair`.
6. A `book_id` missing from the Hardcover answer → `details_failure`.
7. `--from` without `--apply` → `would_link` lines, and no insert or `applyRepair`.
8. `--from x --limit 5` → exit 2.

Existing tests pass. Update the existing tests only where the new `book_id` field changes an expected line.

# Acceptance criteria

1. The behavior above; both verification commands pass.
