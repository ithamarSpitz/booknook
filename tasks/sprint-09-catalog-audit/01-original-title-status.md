---
id: S9-T1
stage: 1
model_class: worker
timeout_minutes: 20
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/migrations/20261105000100_original_title_status.sql
  - supabase/tests/07_original_title_status.sql
context:
  - contract
  - architecture.data_model
  - architecture.testing
environment: null
verification:
  - >-
    node -e "const t=require('fs').readFileSync('supabase/migrations/20261105000100_original_title_status.sql','utf8').toLowerCase();if(!/alter type public\.resolve_status add value if not exists 'original_title'/.test(t))throw new Error('missing enum value');require('fs').accessSync('supabase/tests/07_original_title_status.sql')"
---

# Goal

The database accepts the new edition status `original_title` (contract: `resolve_status` values).

# Scope

1. New migration `supabase/migrations/20261105000100_original_title_status.sql`: `alter type public.resolve_status add value if not exists 'original_title';` and nothing else. Look at `20261102000200_english_editions.sql`, which added `hardcover` the same way.
2. New pgTAP test `supabase/tests/07_original_title_status.sql` in the style of `05_english_editions.sql`: the enum contains `original_title`, and an `editions` row can be updated to `resolve_status = 'original_title'` with a `work_id` (inside the test transaction, rolled back).

`npm run test:db` needs Docker and runs in CI, so it is not in this task's verification. Write the test carefully against the existing schema and tests.

# Acceptance criteria

1. The migration and test above; nothing else changed.
