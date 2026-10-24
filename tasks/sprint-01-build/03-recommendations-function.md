---
id: S1-T3
stage: 1
model_class: hard_worker
timeout_minutes: 45
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/functions/recommendations/**
  - supabase/functions/_shared/hardcover.ts
  - tests/functions/recommendations*.test.ts
  - tests/functions/rec-helpers/**
  - tests/functions/fixtures/hardcover/**
context:
  - contract
  - architecture.functions
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Change `recommendations` so it reads the user's library from the database, excludes everything already shelved and dismissed, and stores its results, per the contract.

# Required context

`docs/contract.md`, `docs/architecture/functions.md` (the 7 steps), `matching.md` (localize). Existing `recommendations/index.ts`, `_shared/hardcover.ts`, `_shared/bridges.ts`, `db.ts`, `types.ts`.

# Scope

1. Seeds from the JWT user's `read` and `reading` shelves, with the seed selection rule.
2. Scoring as today, from `works.similar_ids`.
3. Exclusions: any shelved work, dismissed recommendations.
4. Load missing candidate works from Hardcover in batches of 50 and upsert `works` (include `cached_tags`; extend the Hardcover query in `hardcover.ts` if it does not fetch tags).
5. Localize with an `editions` lookup by `work_id` first, then the existing bridge; bounded parallelism and attempt limit.
6. `shared_tags` computed from stored tags only.
7. Replace the user's non-dismissed rows; return the cards.
8. Linking a localized edition (contract, "Linking a localized edition"): when a new `editions` row is needed, fetch Simania details and rating with a small helper inside `recommendations/` (same MCP call pattern as `_shared/simania.ts`). `_shared/simania.ts` belongs to S1-T2, which runs in parallel; the duplication is accepted and S1-T10 may consolidate it.
9. Put pure logic (seed selection, scoring, exclusion, shared tags) in `recommendations/logic.ts` and unit test it. Test the handler with stubbed `fetch` and a fake DB client: zero seeds, exclusion of shelved and dismissed, English-only result kept with null `simania_id`, unauthenticated 401.

# Out of scope

`_shared/simania.ts`, `_shared/bridges.ts`, `_shared/types.ts`, `_shared/db.ts`, add-book, migrations, web.

# Invariants

- No live network calls in tests.
- Never invent tags or reasons.
- If you need a change in a file you do not own, stop and report it.

# Acceptance criteria

1. Type check and tests pass.
2. A book on the user's "רוצה לקרוא" shelf is never returned.
