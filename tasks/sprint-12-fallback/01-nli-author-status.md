---
id: S12-T1
stage: 1
model_class: worker
timeout_minutes: 25
review: true
allow_protected: true
depends_on: []
allowed_paths:
  - supabase/migrations/20261107000100_nli_author_status.sql
  - supabase/tests/10_nli_author_status.sql
  - supabase/functions/_shared/types.ts
context:
  - contract
  - architecture.data_model
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - >-
    node -e "const t=require('fs').readFileSync('supabase/migrations/20261107000100_nli_author_status.sql','utf8');if(!/alter type public\.resolve_status add value if not exists 'nli_author'/.test(t))throw new Error('missing enum value');require('fs').accessSync('supabase/tests/10_nli_author_status.sql')"
---

# Goal

Editions linked by the catalog fallback are marked as such, so they can be listed and undone.

# Scope

Contract: "Catalog fallback for English-only books" (`resolve_status` gains `nli_author`).

1. New migration `supabase/migrations/20261107000100_nli_author_status.sql`: `alter type public.resolve_status add value if not exists 'nli_author';` Follow `20261105000100_original_title_status.sql`.
2. New pgTAP `supabase/tests/10_nli_author_status.sql`: the enum contains `nli_author`, and an edition can be stored with it. Follow `07_original_title_status.sql`.
3. `supabase/functions/_shared/types.ts`: add `"nli_author"` to `ResolveStatus`. Change nothing else.

Do not run `supabase db reset` or `supabase test db`; CI runs the database tests.

# Acceptance criteria

1. The behavior above; the checks pass.
