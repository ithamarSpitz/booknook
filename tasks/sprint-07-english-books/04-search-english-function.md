---
id: S7-T4
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S7-T3
allowed_paths:
  - supabase/functions/search-english/index.ts
  - supabase/config.toml
  - tests/functions/search-english-handler.test.ts
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

New Edge Function `search-english`: the browser's search for English books on Hardcover (the Hardcover key stays on the server).

# Scope

1. `supabase/functions/search-english/index.ts`, same structure as `supabase/functions/match-by-author/index.ts` (deps object with `requireUser` and an injectable `searchEnglish` from `_shared/english.ts`; `createHandler(overrides)`; `handler`; `Deno.serve` under `import.meta.main`). Behavior is the contract section `search-english`: `query` must be a string (`400`), signed-in user (`401`), `{ books }` response, provider failure `502`.
2. `supabase/config.toml`: add `[functions.search-english]` with `verify_jwt = true`, like the others. Change nothing else.

# Tests (new `tests/functions/search-english-handler.test.ts`)

1. Valid query → the injected search's books are returned.
2. Missing/non-string query → 400; unauthenticated → 401; search throws a provider error → 502.

# Acceptance criteria

1. The behavior above; all tests pass.
