---
id: S30-T4
stage: 2
model_class: worker
timeout_minutes: 20
review: true
allow_protected: true
depends_on:
  - S30-T1
allowed_paths:
  - supabase/migrations/20261121000100_omnibus_status.sql
  - supabase/functions/_shared/types.ts
  - supabase/functions/link-edition/index.ts
  - tests/functions/link-edition-handler.test.ts
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

A link made by the omnibus rule is stored with its own status, `omnibus`, so every such link can be listed. Contract: "**Omnibus volumes (S30).**" and the `resolve_status` values.

# Scope

1. New migration `supabase/migrations/20261121000100_omnibus_status.sql`, written like `20261107000100_nli_author_status.sql`:
   - a comment line;
   - `alter type public.resolve_status add value if not exists 'omnibus';`.
2. `supabase/functions/_shared/types.ts`: add `"omnibus"` to `ResolveStatus`.
3. `supabase/functions/link-edition/index.ts`:
   - accept `source` `omnibus` exactly as `nli_author` is accepted (same checks, same claim of an unlinked row, same `409` rules);
   - update the `400` message to list it.
4. Change nothing else.

# Tests

In `tests/functions/link-edition-handler.test.ts`, next to the `nli_author` tests:
1. `source: "omnibus"` links an unlinked edition and stores `resolve_status` `omnibus`.
2. `omnibus` never relinks an edition of another work (`409`).
3. An unknown source (for example `"box"`) is still `400`.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
