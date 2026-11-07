---
id: S12-T3
stage: 2
model_class: hard_worker
timeout_minutes: 50
review: true
allow_protected: true
depends_on:
  - S12-T1
  - S12-T2
allowed_paths:
  - supabase/functions/_shared/hebrew-candidates.ts
  - supabase/functions/hebrew-candidates/index.ts
  - supabase/functions/_shared/types.ts
  - supabase/config.toml
  - tests/functions/hebrew-candidates-handler.test.ts
  - tests/functions/hebrew-candidates.test.ts
  - tests/functions/fixtures/nli-author/**
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

Given an English work, the server can list the Hebrew titles that may be its translation, each tagged with the rule that ties it to the work.

# Scope

Contract: "Catalog fallback for English-only books", **`hebrew-candidates`** . Reference: `tasks/sprint-12-fallback/reference/` (read `README.md` first). It holds the working probes; follow them for query strings and parsing. The contract wins where they differ, and the probes are never imported.

New `supabase/functions/_shared/hebrew-candidates.ts`:
- `export async function hebrewCandidates(work: { title: string; author: string; description: string | null }, deps?)` returns `{ candidates: { title, author, rule }[]; english_names: string[] }`.
- `deps` injects `fetch` (NLI SRU and Wikidata), `wikidataHebrew` and `nliHebrew` (from `bridges.ts`), and a clock. Defaults are the real ones.
- Implement the NLI authority query and its MARC parsing (245/100/240), rules A, B, D, C, E, F and G in the contract's order, the de-duplication, the cap of 8, the `english_names` extraction (stop list, title words and author words removed), and the request bounds (2 NLI, 4 Wikidata, 20 s).
- A provider failure drops only that rule's candidates.
- Import `titleMatch`, `mainTitle` (`_shared/fallback-match.ts`) and `nameSoundScore` (`_shared/names.ts`). Do not reimplement them, and do not import from `public/js`.

New function `supabase/functions/hebrew-candidates/index.ts`, following `genre-hint/index.ts`:
- JWT, `400` for a bad body, and `404` unless the caller has a non-dismissed recommendation or a `genre_recommendations` row for `work_id`.
- Load the work's `original_title`, `original_authors[0]` and the Hardcover description (one `hardcoverBooks` call), call `hebrewCandidates`, and return `HebrewCandidatesResponse`. A Hardcover failure means `description: null`.
- Add `HebrewCandidatesRequest`/`HebrewCandidatesResponse` to `_shared/types.ts`, and `[functions.hebrew-candidates] verify_jwt = true` to `supabase/config.toml`.

# Tests (new `tests/functions/hebrew-candidates.test.ts`, fixtures only)

Save small MARCXML fixtures under `tests/functions/fixtures/nli-author/`. Trim real responses, or build them in the shape the probe parsed.
1. A record with 240 `To hate Adam Conor. Hebrew` gives a rule-A candidate `לשנוא את אדם קונור`, author `אלה מייז`.
2. Snow Crash: `סנוקראש` with no 240 gives rule B.
3. Anxious People: 240 `Folk med Ångest` plus a fake Wikidata item labeled `Folk med ångest` with a matching P50 gives rule D.
4. Never Lie: the Hardcover description gives `english_names` containing Tricia and Ethan, without "Freida", "McFadden", "Never" or "Lie". The no-240 records come back as rule G.
5. An NLI failure still returns the rule E/F candidates. A Wikidata failure still returns A/B/G.
6. No more than 8 candidates, with no duplicates.
7. The fixtures never call the network.
8. Handler (new `tests/functions/hebrew-candidates-handler.test.ts`, fake DB as in `genre-hint.test.ts`): `404` without a row, `200` with a genre row and with a recommendation row, `400` for a bad body.

# Acceptance criteria

1. The behavior above; all tests pass.
