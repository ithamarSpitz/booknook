---
id: S7-T9
stage: 5
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S7-T7
  - S7-T8
allowed_paths:
  - scripts/verify-english.ts
  - package.json
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run verify:english
  - npm run verify:localization
---

# Goal

A live gate proving, against real Hardcover, that English books can be found and stored with complete, clean details.

# Scope

1. New `scripts/verify-english.ts` (Deno; same conventions as `scripts/verify-resolution.ts`: `HARDCOVER_API_KEY` from env or `BOOKNOOK_ENV_FILE`, never printed; in-memory `FakeDb`; one retry after 5 s on a provider failure). Using the real `searchEnglish` and `ensureEnglishEdition` from `supabase/functions/_shared/english.ts`:
   - `searchEnglish("Spin Robert Charles Wilson")` includes Hardcover 383752 with author containing "Wilson".
   - `searchEnglish("Project Hail Mary")` includes a book titled "Project Hail Mary" by Andy Weir.
   - `ensureEnglishEdition(db, 383752)`: edition `-383752`, status `hardcover`, linked to a work with `hardcover_id` 383752; title "Spin"; author contains "Wilson"; description non-empty with no `<` or `>` characters; rating between 0 and 5 with a positive count; cover URL starts with `https://`; year 2005.
   - Running it again returns the same row without a provider call (count fetches).
   Print one line per check; exit non-zero on any failure.
2. `package.json`: add `"verify:english": "deno run --allow-net --allow-env --allow-read scripts/verify-english.ts"`; change nothing else.

# Rules

Do not change application code; if a check fails because of application behavior, report the output in `OPEN_ISSUES` instead of weakening it.

# Acceptance criteria

1. The gate passes against this sprint's merged code, and `verify:localization` still passes.
