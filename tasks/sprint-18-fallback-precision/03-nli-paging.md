---
id: S18-T3
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S18-T1
allowed_paths:
  - supabase/functions/_shared/hebrew-candidates.ts
  - tests/functions/hebrew-candidates.test.ts
context:
  - contract
  - architecture.functions
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Rule A sees every NLI record of a prolific author (up to 300), so translations of authors like Agatha Christie, Stephen King and Enid Blyton are no longer missed after the first 100 records.

# Scope

Contract: "Catalog fallback for English-only books", the "- NLI records:" line (paging) and "- Bounds:" (at most 4 NLI requests, within 25 seconds).

In `supabase/functions/_shared/hebrew-candidates.ts` only:
1. The creator query reads pages with `startRecord` 1, 101, 201 and `maximumRecords=100`. It stops after a page with fewer than 100 records, or after 3 pages. It keeps the records in page order.
2. The uniform-title query stays one request.
3. The time limit is 25 seconds. A failed later page keeps the records already read; it does not turn into a failure of the whole rule.
4. Nothing else changes: candidate order, rules, `english_names`.

# Tests (`tests/functions/hebrew-candidates.test.ts`)

1. With a mocked NLI returning 100, 100 and 30 records, 3 creator requests are made (`startRecord` 1, 101, 201), and a rule A record from page 3 becomes a candidate.
2. A first page with 40 records makes exactly 1 creator request.
3. A failure on page 2 keeps page 1's candidates.
4. At most 4 NLI requests in total.
5. Existing tests pass.

# Acceptance criteria

1. The behavior above; `check:functions` and `test:functions` pass.
