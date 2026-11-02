---
id: S8-T2
stage: 1
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/functions/_shared/genres.ts
  - tests/functions/genres.test.ts
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

Pure, deterministic logic for genre recommendation shelves: the Hebrew genre map and the shelf computation, with no database or network access.

# Scope

Contract: "Genre recommendation shelves", steps 1 to 4. New `supabase/functions/_shared/genres.ts`:

1. `GENRE_MAP`: exactly the contract's list (Hebrew name → aliases), in that order.
2. `workGenres(tags)`: distinct Hebrew names from the first 8 `Genre` tags of a `CachedTags` object (case-insensitive, trimmed alias match), in tag order.
3. `qualifyingGenres(seeds)`: `seeds` are `{ workId, weight, tags, similarIds }`; returns genres with `count >= 2` ordered by evidence desc, count desc, Hebrew name; each with its seeds.
4. `genreCandidates(genre, genreSeeds)`: candidate hardcover IDs with summed scores from the first 40 `similarIds` (`weight * (1 - rank/40)`), ordered by score desc then id asc.
5. `buildGenreShelves({ seeds, worksByHardcoverId, excludedWorkIds })` returning `{ genre, books: { workId, hardcoverId, score }[] }[]`: walks qualifying genres in order; per genre keeps candidates whose loaded work has that genre, skips excluded works and works placed on an earlier shelf, takes up to 12, drops a genre with fewer than 4, stops at 5 shelves. Candidates missing from `worksByHardcoverId` are skipped.
6. `missingCandidateIds(seeds, worksByHardcoverId, limit = 100)`: the highest-scored candidate hardcover IDs (across qualifying genres) not yet loaded, at most `limit`, so the caller can load them first.

# Tests (new `tests/functions/genres.test.ts`)

1. `workGenres`: "Sci-fi" and "Space" both map to מדע בדיוני once; `General`, `did-not-finish` ignored; only the first 8 tags read; case-insensitive.
2. A genre with one seed does not qualify; two seeds do; ordering by evidence then count then name.
3. Shelf books: excluded and shelved works skipped; a work on shelf 1 is not repeated on shelf 2; max 12; a genre with 3 books dropped and the next genre takes its place; max 5 shelves; zero qualifying genres → `[]`.
4. `missingCandidateIds` respects the limit and score order.
5. Determinism: same input → same output.

# Acceptance criteria

1. The behavior above; all tests pass.
