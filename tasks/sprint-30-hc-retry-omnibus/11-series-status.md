---
id: S30-T11
stage: 3
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S30-T4
  - S30-T9
allowed_paths:
  - supabase/migrations/20261121000200_series_status.sql
  - supabase/functions/_shared/types.ts
context:
  - contract
  - architecture.data_model
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "const fs=require('fs');if(!/add value if not exists 'series'/.test(fs.readFileSync('supabase/migrations/20261121000200_series_status.sql','utf8')))throw new Error('migration');if(!fs.readFileSync('supabase/functions/_shared/types.ts','utf8').includes('\"series\"'))throw new Error('types')"
---

# Goal

Editions linked by `series:links` get their own status, `series`. Contract: the `resolve_status` values.

# Scope

1. New migration `supabase/migrations/20261121000200_series_status.sql`, written like `20261121000100_omnibus_status.sql`:
   - a comment line;
   - `alter type public.resolve_status add value if not exists 'series';`.
2. `supabase/functions/_shared/types.ts`: add `"series"` to `ResolveStatus`.
3. Change nothing else. `link-edition` does not accept `series`.

# Acceptance criteria

1. All three verification commands pass.
