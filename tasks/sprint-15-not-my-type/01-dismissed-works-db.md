---
id: S15-T1
stage: 1
model_class: worker
timeout_minutes: 35
review: true
allow_protected: true
depends_on: []
allowed_paths:
  - supabase/migrations/20261118000100_dismissed_works.sql
  - supabase/tests/11_dismissed_works.sql
  - supabase/functions/_shared/types.ts
context:
  - contract
  - architecture.data_model
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run check:contract
  - >-
    node -e "const t=require('fs').readFileSync('supabase/migrations/20261118000100_dismissed_works.sql','utf8');for(const w of ['dismissed_works','dismiss_work','restore_work','not_my_type'])if(!t.includes(w))throw new Error('missing '+w);require('fs').accessSync('supabase/tests/11_dismissed_works.sql')"
---

# Goal

The database remembers which recommended books a reader removed and why, for both the Recommendations page and the genre shelves, and lets the reader bring one back.

# Scope

Contract: the "`dismissed_works`" section (table, RLS, `dismiss_work`, `restore_work`, backfill, grant change).

1. New migration `supabase/migrations/20261118000100_dismissed_works.sql`:
   - the table with its check, RLS and grants;
   - the two RPCs (security definer, `set search_path = public`, execute revoked from PUBLIC and anon, granted to authenticated);
   - the backfill from `recommendations.dismissed = true`;
   - `revoke update (dismissed) on public.recommendations from authenticated`.

   Follow the style of the earlier migrations (`20261103000100_genre_recommendations.sql` for RLS and grants, `20261026000100_set_rating.sql` for an `auth.uid()` RPC).
2. New pgTAP `supabase/tests/11_dismissed_works.sql`, following `06_genre_recommendations.sql`:
   - `dismiss_work` with each kind stores the row; a second call with the other kind replaces the kind.
   - A bad kind raises `22023`; an unknown work raises `23503`.
   - `dismiss_work` sets this user's `recommendations.dismissed` and deletes this user's `genre_recommendations` rows for that work, and leaves another user's rows untouched.
   - `restore_work` deletes the `dismissed_works` row and the `recommendations` row; restoring twice does nothing.
   - A client cannot insert into, update or delete from `dismissed_works`, and cannot select another user's rows.
   - A client cannot `update recommendations set dismissed = true` any more.
   - The backfill turns an existing dismissed recommendation into a `hide` row.
3. `supabase/functions/_shared/types.ts`: add `DismissKind = "hide" | "not_my_type"` and `DismissedWorkRow`. Change nothing else.

Do not run `supabase db reset` or `supabase test db`; CI runs the database tests.

# Acceptance criteria

1. The behavior above; the checks pass.
