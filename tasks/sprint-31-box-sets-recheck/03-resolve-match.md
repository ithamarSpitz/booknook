---
id: S31-T3
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S31-T1
allowed_paths:
  - supabase/functions/_shared/catalog.ts
  - tests/functions/resolve-match.test.ts
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

A refactor with no behavior change. Export `resolveMatch(db, edition, overrides)` from `supabase/functions/_shared/catalog.ts`. It is the Wikidata → NLI → fuzzy decision that `ensureResolved` makes today, without writing. `ensureResolved` then calls it. Contract: the `resolveMatch` sentence under "**`npm run recheck:links`**".

# Scope

- `resolveMatch` does everything `ensureResolved` does from the match title through the author guard:
  - the bridges, the hints (the catalog hint reads stay), the Hardcover matches and the guards;
  - the S30 options and series prefix.
- It returns `{ book: HardcoverBook, status: "wikidata" | "nli" | "fuzzy" } | null`, plus `failed: boolean` (any provider failure counted). Use a small result type.
- It never writes, never upserts a work and ignores `resolve_status` and `resolved_at`.
- `ensureResolved` keeps its early return (pending, or stale `not_found`). It then calls `resolveMatch` and does the work upsert and edition update exactly as now, including `pending` on failure.
- No behavior change for `ensureResolved`: every existing test passes unchanged.

# Tests

New `tests/functions/resolve-match.test.ts`:
1. With a FakeDb and provider overrides, a Wikidata hit returns `{ status: "wikidata" }` with that book, and the FakeDb shows no `editions` or `works` writes.
2. An NLI hit returns `nli`; a fuzzy hit returns `fuzzy`; nothing found returns `null` with `failed: false`.
3. A provider that throws returns `null` with `failed: true`.
4. An edition that is already linked (`work_id` set, `resolve_status` `wikidata`) is still evaluated, not returned early.

# Acceptance criteria

1. The behavior above; both verification commands pass, with all existing tests unchanged.
