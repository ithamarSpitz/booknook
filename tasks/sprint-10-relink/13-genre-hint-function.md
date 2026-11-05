---
id: S10-T13
stage: 3
model_class: worker
timeout_minutes: 35
review: true
allow_protected: true
depends_on:
  - S10-T6
  - S10-T9
allowed_paths:
  - supabase/functions/genre-hint/index.ts
  - supabase/functions/_shared/types.ts
  - supabase/config.toml
  - tests/functions/genre-hint.test.ts
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

The browser can ask for the Hebrew title hint and the Hebrew author name of a genre shelf book. The recommendations function computes these for its own English-only cards; this function does the same for genre books.

# Scope

Contract: **`genre-hint`**.

1. New Edge Function `supabase/functions/genre-hint/index.ts`, in the style of the existing functions (CORS, auth, `HttpError`, injectable deps for tests).
   - `POST { work_id }`.
   - Requires a JWT. The caller must have a `genre_recommendations` row for `work_id` (read with the caller's client), otherwise `404`. A missing or non-UUID `work_id` gives `400`.
   - Load the work. Compute `hebrew_hint` with the same `defaultHebrewHint` the recommendations function uses, and `hebrew_author` with `hebrewAuthorFor`, which S10-T6 made positive-ID only. Import these from where they live; do not copy them. If one must move to `_shared` to be importable, keep its behavior identical and make sure the `recommendations` tests still pass.
   - Answer `{ work_id, hebrew_hint, hebrew_author }`. A provider failure gives nulls, not an error. Write nothing.
2. This brief explicitly allows editing `supabase/config.toml`: add only `[functions.genre-hint]` with `verify_jwt = true`, like the other entries. Change nothing else in that file.
3. `supabase/functions/_shared/types.ts`: add `GenreHintRequest` and `GenreHintResponse`.

The deploy workflow deploys every function directory, so no workflow change is needed. Check `.github/workflows/` and report.

# Tests (`tests/functions/genre-hint.test.ts`, fakes only)

1. A caller with a genre row gets the hint and author from the fake deps.
2. A caller without a genre row gets `404`. A bad body gets `400`. No JWT gets `401`, as the other functions answer.
3. A hint provider that throws gives `hebrew_hint: null` and status `200`.

# Acceptance criteria

1. The behavior above; all tests pass.
