---
id: S17-T4
stage: 3
model_class: hard_worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on:
  - S17-T2
allowed_paths:
  - supabase/functions/_shared/genres.ts
  - tests/functions/genres.test.ts
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

The genre shelf plan follows the reader's choices: pinned genres first, hidden ones never, up to N shelves (1-20). The run also lists every genre found for the reader.

# Scope

Contract: "Genre recommendation shelves", steps 3a, 4 (the 200-work cap and the minimum moved to 3a) and 7 "Reader genres (S17)".

Pure functions in `supabase/functions/_shared/genres.ts` only (the handler wiring is S17-T5):
1. `buildGenreShelves` takes the shelf count N and the preferences (`{ genreKey, state, pinOrder }[]`), and builds the step 3a plan:
   - hidden genres are skipped;
   - pinned genres come first by `pinOrder`, at most N − 1. Their candidates come from all genre seeds, filtered to the genre, and they keep 1-12 books;
   - automatic genres follow, each needing at least 4 books, until there are N shelves;
   - each shelf has `genreKey`, `genre` (display name), `pinned` and `books`.
   With no preferences and N = 5, the result equals today's behavior.
2. `missingCandidateIds` covers the same plan (pinned genres included) with a default limit of 200.
3. New `readerGenres(...)`: step 7 (counts, filter, order, first 100, display names).

# Tests (`tests/functions/genres.test.ts`)

1. A hidden genre that would qualify gets no shelf, and the next one takes its place.
2. A pinned genre with only 1 seed that has it (so it does not qualify) gets a shelf first, with candidates from other seeds that carry the genre; a pinned genre with 2 books keeps them.
3. With N = 3 and 3 pins, only the first 2 pins (by `pinOrder`) appear, plus 1 automatic shelf.
4. N = 20 gives up to 20 shelves; a book is on one shelf only.
5. With no preferences and N = 5, the output matches the current behavior on the existing fixtures.
6. `readerGenres`:
   - counts seeds and candidates;
   - excludes shelved and dismissed works from `candidate_count`;
   - drops keys with 0 seeds and fewer than 3 candidates;
   - order and cap 100.
7. `missingCandidateIds` includes a pinned genre's candidates and caps at 200.

# Acceptance criteria

1. The behavior above; `check:functions` and `test:functions` pass.
