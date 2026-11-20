---
id: S25-T3
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S25-T1
allowed_paths:
  - supabase/functions/_shared/utils.ts
  - supabase/functions/_shared/names.ts
  - tests/functions/name-sound.test.ts
  - tests/functions/match-title.test.ts
context:
  - contract
  - architecture.matching
  - architecture.functions
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Server matching ignores Hebrew points, the same way as the browser. Contract: "**Hebrew points (S25).**".

# Scope

1. `supabase/functions/_shared/utils.ts`:
   - export `stripHebrewPoints(value: string): string`: removes U+0591 to U+05C7 except U+05BE, which becomes a space;
   - `normalize` applies it first, before NFKD.
2. `supabase/functions/_shared/names.ts`: `nameSoundScore` and the Hebrew skeleton functions apply it to the Hebrew name first.
3. Nothing else changes. Text without points gives exactly the same results as before.

# Tests

1. `tests/functions/match-title.test.ts`:
   - `similarity("אינטרמצו", "אִינְטֶרְמֶצּוֹ") === 1`;
   - `normalize("בית־ספר") === "בית ספר"`;
   - `titleMatch("אינטרמצו", "אִינְטֶרְמֶצּוֹ")` is true (from `_shared/fallback-match.ts`).
2. `tests/functions/name-sound.test.ts`: `nameSoundScore("סָאלִי רוּנִי", ["Sally Rooney"])` equals the unpointed score.
3. Existing tests pass, including `fallback-parity.test.ts`.

# Acceptance criteria

1. The behavior above; both verification commands pass.
