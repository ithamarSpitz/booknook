---
id: S7-T2
stage: 1
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/migrations/20261102000200_english_editions.sql
  - supabase/tests/05_english_editions.sql
context:
  - contract
  - architecture.data_model
  - architecture.testing
environment: null
verification:
  - >-
    node -e "const t=require('fs').readFileSync('supabase/migrations/20261102000200_english_editions.sql','utf8').toLowerCase();for(const w of ['add value if not exists','hardcover','1013521','372879'])if(!t.includes(w))throw new Error('migration missing '+w);require('fs').accessSync('supabase/tests/05_english_editions.sql')"
---

# Goal

The database accepts English editions, and the one wrong Hebrew link found in production is removed.

# Scope

1. New migration `supabase/migrations/20261102000200_english_editions.sql`:
   - `alter type public.resolve_status add value if not exists 'hardcover';` (contract "Shared values").
   - Data fix (live bug: Simania 1013521 "כיבוי אורות" by David Koepp is linked to Kim Stanley Robinson's "Aurora", Hardcover 372879): first set `recommendations.simania_id = null` where `simania_id = 1013521` and the recommendation's work has `hardcover_id = 372879`; then set that edition's `work_id = null`, `resolve_status = 'not_found'`, `resolved_at = now()` only if it is linked to the work with `hardcover_id = 372879`. Both statements must be no-ops on a database without those rows (local and CI).
   - Do not use the new enum value elsewhere in this migration (PostgreSQL forbids using a new enum value in the transaction that adds it).
2. New pgTAP test `supabase/tests/05_english_editions.sql`, in the style of the existing files in `supabase/tests/`: `'hardcover'` is a valid `resolve_status`; an `editions` row with a negative `simania_id`, a `work_id` and status `hardcover` can be inserted and shelved by its user through the normal `shelf_books` insert; the trigger's same-work rule still blocks shelving a second edition of that work.

The pgTAP test runs in CI (`npm run test:db` needs Docker, so it is not in this task's verification). Write it carefully against the existing schema, trigger and tests.

# Acceptance criteria

1. The migration and test above; nothing else changed.
