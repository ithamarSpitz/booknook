---
id: S17-T2
stage: 2
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S17-T1
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

A work's genres come from its Hardcover tags through normalization, noise filtering, the alias table and compound splitting, instead of the fixed 22-name map. Unknown real genres become `en:` genres.

# Scope

Contract: "Genre recommendation shelves", step 1 "Genre keys and names (S17)", and the step 3 wording.

In `supabase/functions/_shared/genres.ts` only:
1. `normalizeGenreTag(tag)`, the noise rule, and the alias table exactly as the contract lists them (Hebrew name = key = display name).
2. Compound splitting.
3. `workGenres(tags)` returns the distinct genre keys of the first 12 `Genre` tags, in tag order.
4. A helper that gives the display name for a key: the Hebrew name for an alias genre; for an `en:` key, the cleaned original spelling chosen by the contract rule (first genre seed in seed order whose work carries it, else the lowest-`hardcover_id` loaded candidate). Callers pass the seeds and works, so the function stays pure.
5. `qualifyingGenres` works on keys and breaks ties by display name with Hebrew collation.

Keep the existing exports working for current callers: `buildGenreShelves` and `missingCandidateIds` keep their signatures and today's 5-shelf behavior in this task (S17-T4 changes the plan). Each shelf object also gets `genreKey` next to `genre` (the display name).

# Tests (`tests/functions/genres.test.ts`)

1. Normalization: `"Thriller"`, `["Thriller`, `Historical-Fiction` and `Humour` all reach their Hebrew genres.
2. Every noise example in the contract gives no genre, including `physical-tbr`, `2023` and `Read in 2024`.
3. `Science Fiction & Fantasy` gives both `מדע בדיוני` and `פנטזיה`; `Family & Relationships` gives `משפחה` (an alias); `Action & Adventure` gives `הרפתקאות`; `Foo & Fantasy` gives the single key `en:foo & fantasy`.
4. An unknown tag such as `Cli-Fi` gives `en:cli fi`, with display name `Cli-Fi` from the first seed that has it.
5. Duplicates collapse, and the order follows the tags.
6. Only the first 12 tags are read.
7. The old Hebrew keys are unchanged, so an old row's `genre` equals the new key.
8. Existing genre tests pass, updated only where the contract changed (12 tags instead of 8, keys).

# Acceptance criteria

1. The behavior above; `check:functions` and `test:functions` pass.
