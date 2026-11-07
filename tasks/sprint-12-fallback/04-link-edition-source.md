---
id: S12-T4
stage: 2
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on:
  - S12-T1
allowed_paths:
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

The browser can link an edition found by the catalog fallback, and it is recorded as such, with the same never-relink protection as every other link.

# Scope

Contract: `link-edition` and "Catalog fallback for English-only books".

1. `supabase/functions/link-edition/index.ts`: accept `source` `"nli_author"` in addition to `wikidata` and `nli`. Update the `400` message. An edition claimed by this call gets `resolve_status = 'nli_author'`. Every other rule stays as it is: claim only while `work_id` is null, keep an existing same-work link with its status, `409` for a different work, and the shelf rule.

# Tests (`tests/functions/link-edition-handler.test.ts`)

1. `nli_author` links an unlinked edition and stores `resolve_status = 'nli_author'`.
2. `nli_author` on an edition already linked to a different work answers `409` and changes nothing (the never-relink guarantee).
3. `nli_author` on an edition already linked to the same work keeps its existing `resolve_status`.
4. An unknown `source` is still `400`.

# Acceptance criteria

1. The behavior above; all tests pass.
