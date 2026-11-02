---
id: S6-T4
stage: 2
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S6-T2
allowed_paths:
  - supabase/functions/match-by-author/index.ts
  - supabase/config.toml
  - tests/functions/match-by-author-handler.test.ts
  - tests/functions/helpers/fake-db.ts
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

New Edge Function `match-by-author`: given a recommended work and Hebrew Simania candidates by the same author (found by the browser), it proves which candidate is the same work by resolving it Hebrew → English, never by guessing.

# Why (live evidence, Nov 2026)

Simania's author search finds Hebrew editions whose titles no bridge links in the English → Hebrew direction (A Man Called Ove → איש ושמו אובה, A Flicker in the Dark → הבהוב באפלה, The Housemaid's Secret → הסוד של עוזרת הבית). Resolving each candidate with the existing Hebrew → English procedure and comparing Hardcover ids gives an exact, deterministic answer.

# Scope

1. `supabase/functions/match-by-author/index.ts`, same structure as `supabase/functions/link-edition/index.ts` (dependency object with `requireUser`, `userClient`, `serviceClient`, `ensureResolved`, `now`; `createHandler(overrides)`; `handler`; `Deno.serve` under `import.meta.main`). Types `MatchByAuthorRequest`, `MatchByAuthorResponse`, `AuthorCandidate` exist in `_shared/types.ts` (do not edit it). Behavior is the contract section "`match-by-author`":
   - Validate: `work_id` string, `candidates` an array of 1 to 8 items with integer `simania_id` > 0 and non-empty `title` (`400` otherwise).
   - The caller must have a non-dismissed recommendation for `work_id` (user client; `404` otherwise). Read the work's `hardcover_id` (service client).
   - Export the core as `matchCandidates(db, hardcoverId, candidates, deps)`: for each candidate in order, read its `editions` row; if absent insert a minimal row (`simania_id`, `title`, `author`, `resolve_status: "pending"`, other fields null); if it has a `work_id`, read that work's `hardcover_id`; otherwise run `deps.ensureResolved(db, row)` and read the linked work. Return the first candidate whose work `hardcover_id` equals `hardcoverId`, with its `resolve_status`. Do not start a new candidate after 25 seconds (`deps.now`). Any error for one candidate skips it.
   - Respond `{ simania_id, resolve_status }` or `{ simania_id: null, resolve_status: null }` with 200.
2. `supabase/config.toml`: add `[functions.match-by-author]` with `verify_jwt = true`, like the others. Change nothing else.

If the fake DB lacks something you need, add it to `tests/functions/helpers/fake-db.ts` without changing existing behavior.

# Tests

New `tests/functions/match-by-author-handler.test.ts` (fake DB, injected `ensureResolved`, no live calls):

1. Two candidates; the first resolves to another work, the second to the recommended work's `hardcover_id` → returns the second, the first stays linked to its own work.
2. Candidate already linked to the recommended work → returned without calling `ensureResolved`.
3. No candidate matches → nulls; a candidate whose resolution throws is skipped.
4. 9 candidates or a bad candidate → 400; no recommendation for the caller → 404; unauthenticated → 401.
5. Time budget: with `now` advancing past 25 s after the first candidate, no further candidate is resolved.

# Acceptance criteria

1. The behavior above, all tests passing; `npm run check:functions` covers the new function.
