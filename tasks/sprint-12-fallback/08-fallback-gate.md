---
id: S12-T8
stage: 4
model_class: hard_worker
timeout_minutes: 45
review: true
allow_protected: false
depends_on:
  - S12-T6
allowed_paths:
  - scripts/verify-fallback.ts
  - package.json
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run verify:fallback
---

# Goal

Before release, a live check proves the fallback finds the measured Hebrew editions and rejects the known wrong ones.

# Scope

Contract: "Catalog fallback for English-only books" (the table of expected links and the must-not-link cases). Reference: `tasks/sprint-12-fallback/reference/` (read `README.md` first). The probes show the real provider calls; the contract wins where they differ, and the probes are never imported.

1. `package.json`: add `"verify:fallback": "deno run --allow-net --allow-env --allow-read --allow-sys scripts/verify-fallback.ts"`. Change nothing else.
2. New `scripts/verify-fallback.ts`, read-only and off-cloud:
   - For each case, load the Hardcover book (`hardcoverBooks`, with `HARDCOVER_API_KEY` via `BOOKNOOK_ENV_FILE` as in `verify-localization.ts`).
   - Run `hebrewCandidates` from `_shared/hebrew-candidates.ts` with the real providers. Then run `localizeFallback` from `public/js/recs.js` with the real Simania and a fake `callFunction` that returns those candidates. Record the decided Simania ID; never call `link-edition`.
   - Print `PASS`/`FAIL` per case and exit `1` on any FAIL.
   - Cases:
     - All 21 rows of the contract table, each with its expected ID (Canticle accepts either ID).
     - Aurora (Kim Stanley Robinson) must not decide 1013521.
     - Behind Closed Doors (B.A. Paris) must not decide 220768.
     - Grass and Stories of Your Life and Others may decide nothing or the right ID (20895 / 42098). They must never decide a different ID.
   - Take Hardcover IDs from a Hardcover title-and-author search. `reference/probe-results.jsonl` lists the books.
   - At most 2 expected-link cases may fail, and only with a provider error that the run prints. A wrong ID always fails.

# Acceptance criteria

1. `npm run verify:fallback` passes on this machine: at least 19 of the 21 expected links, and every must-not-link case.
