---
id: S42-T2
stage: 2
model_class: worker
timeout_minutes: 40
review: true
depends_on:
  - S42-T1
allowed_paths:
  - scripts/rematch-cached.ts
  - tests/functions/rematch-hebrew.test.ts
  - tests/functions/rematch-cached.test.ts
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

Contract: "**Rematch Hebrew editions (S42).**". Add a `--hebrew` mode to `scripts/rematch-cached.ts`.

# Scope

1. **Arguments.**
   - `--hebrew` with `--apply`, `--from` or `--hardcover-id` is a usage error, handled like the existing invalid combinations (same exit code and usage line).
   - `--offset`, `--limit`, `--min-hardcover` and `--force-hardcover` work as they do in normal mode.
   - Add `--hebrew` to the usage line.
2. **Selection:** editions with `simania_id > 0` and `work_id is null`, ordered by `simania_id`, then offset and limit applied. Use an injectable `loadUnlinkedEditions(sql)` dependency, so tests can stub it.
3. **For each edition, sequentially:**
   - Call the same `resolveMatch` dependency that normal mode uses for confirmation.
   - A failure → skip `provider_failure`. No book → skip `no_candidate`.
   - A found book: compute `authorAgreesWithWork(edition.author, authors(book), <authors-table Hebrew names of those authors>)`, as normal mode does. False → skip `author_mismatch`.
   - Otherwise, log one proposal line:
     `{"hardcover_id": <book id>, "title": <book title>, "proposal": {"simania_id": ..., "book_id": <book id>, "hebrew_title": <edition title>, "via": "hebrew", "status": <found status>}}`
4. **Budget:** the Hardcover check every 50 editions, and the summary line with counts, the same as normal mode.
5. **Unchanged:** normal mode and `--from`. `--from` must accept the new lines as they are (`via` is not checked there).

# Tests

New `tests/functions/rematch-hebrew.test.ts`, with stubbed deps:
1. A found book whose authors agree → one proposal line with `via: "hebrew"`, the found status, and the book id. Nothing is linked: no `applyRepair` call.
2. A found book whose authors don't agree (edition author `Dan O'Sullivan`, book by Prince Harry) → `author_mismatch`, and no proposal line.
3. A failing `resolveMatch` → `provider_failure`; the next edition is still processed.
4. `--hebrew --apply` → a usage error.
5. Round trip: the proposal lines from test 1, fed to `--from <file>` (dry), produce a `would_link` line for that edition.

Existing tests pass. Update `rematch-cached.test.ts` only where the new dependency must be added to its deps object.

# Acceptance criteria

1. The behavior above; both verification commands pass.
