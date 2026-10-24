---
id: S1-T1
stage: 1
model_class: hard_worker
timeout_minutes: 50
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/migrations/**
  - supabase/tests/**
  - supabase/seed.sql
context:
  - contract
  - architecture.data_model
  - architecture.testing
environment: null
verification:
  - npm run test:db
---

# Goal

Create the database: tables, enums, RLS, the sign-up trigger and the four RPCs, with pgTAP tests.

# Required context

`docs/contract.md` is authoritative for columns and signatures. `docs/architecture/data-model.md` for rules.

# Scope

1. Migrations under `supabase/migrations/` (timestamped file names).
2. pgTAP tests under `supabase/tests/` covering:
   - a new auth user gets a profile and the four default shelves in order;
   - user A cannot select, update or delete user B's shelves, shelf_books, recommendations or profile;
   - clients cannot write `works`, `editions`, `search_cache`;
   - a user cannot insert a non-custom shelf or delete a default shelf;
   - `move_book` within a shelf and across shelves keeps positions gapless and sets `finished_at` only the first time on a `read` shelf;
   - `move_shelf`, `delete_shelf` (books go to the end of `want`), `remove_book` keep positions gapless;
   - a book cannot sit on two shelves of the same user;
   - the user can update only `dismissed` on recommendations.
3. `supabase/seed.sql`: keep empty or minimal; no real users.

# Out of scope

Edge Functions, web code, `supabase/config.toml`.

# Invariants

- You may run `npm run test:db` (resets the shared local stack). Do not start or stop the stack.
- RPCs are `security invoker` unless the contract says otherwise; if `security definer` is needed, set `search_path` and check `auth.uid()` explicitly.

# Acceptance criteria

1. `npm run test:db` passes from a clean reset.
2. Every RLS and RPC rule above has at least one pgTAP assertion.
