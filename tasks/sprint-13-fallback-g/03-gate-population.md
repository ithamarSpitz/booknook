---
id: S13-T3
stage: 2
model_class: hard_worker
timeout_minutes: 45
review: true
allow_protected: false
depends_on:
  - S13-T1
  - S13-T2
allowed_paths:
  - scripts/verify-fallback.ts
  - scripts/lib/prod-db.ts
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

The live check covers the wrong links found in production, and the operator can review every decision the fallback would make for real readers before applying it.

# Scope

Contract: "Catalog fallback for English-only books" (must-not-link list and **Population review**). Reference: `tasks/sprint-13-fallback-g/reference-rule-g.probe.ts`, which already does the population run over a rows file, and `reference-results.jsonl`, its clean output. The contract wins where they differ, and the probe is never imported.

`scripts/verify-fallback.ts`:
1. Add cases:
   - Pretty Girls (Karin Slaughter) must not decide 41212.
   - The Only One Left (Riley Sager) must not decide 1028558.
   - The Lathe of Heaven (Ursula K. Le Guin) and Watchers (Dean Koontz) must decide nothing.
   - Never Lie still expects 1029088.
2. `--population`: read every English-only, non-dismissed `recommendations` row and every English-only `genre_recommendations` row of every reader, read-only (`openProdDb({ readOnly: true })`, `loadOperatorEnv`). Deduplicate by work, and run the same decision as the fixed cases. Print one JSON line per book as the contract says, then totals: books, decided, by rule, errors. Exit `0` unless a database or Hardcover failure stops it.
3. `scripts/lib/prod-db.ts`: add the read helper only if it is needed; keep existing exports.

# Acceptance criteria

1. `npm run verify:fallback` passes on this machine: every must-not-link case, and at least 19 of the 21 expected links.
2. `npm run verify:fallback -- --population` runs on this machine against production and writes nothing.
