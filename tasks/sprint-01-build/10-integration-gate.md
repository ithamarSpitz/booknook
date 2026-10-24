---
id: S1-T10
stage: 3
model_class: hard_worker
timeout_minutes: 70
review: true
allow_protected: false
depends_on:
  - S1-T1
  - S1-T6
  - S1-T7
  - S1-T8
  - S1-T9
allowed_paths:
  - scripts/verify-integration.mjs
  - tests/integration/**
  - supabase/functions/**
  - supabase/migrations/**
  - supabase/tests/**
  - public/js/**
  - public/css/**
  - public/index.html
context:
  - contract
  - architecture.overview
  - architecture.functions
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - npm run test:web
  - npm run test:db
  - npm run verify:integration
---

# Goal

Prove the merged system works end to end on the local stack with the real external APIs, and fix the integration bugs that only show up when the lanes meet.

# Scope

1. `scripts/verify-integration.mjs`, runnable with `npm run verify:integration`:
   - reads keys from `npx supabase status -o env`;
   - starts the functions with `npm run functions:serve` in the background, waits until they answer, and always stops them at the end;
   - creates two throwaway users with the admin API and deletes them at the end;
   - user A: checks default shelves; `search-books` for "הנסיך הקטן" returns results; `add-book` for 4 well-known translated books (choose ones that resolve through Wikidata, e.g. הנסיך הקטן, 1984, הארי פוטר ואבן החכמים, חוות החיות) onto "קראתי"; at least 3 resolve to a work; `move_book` to "קורא עכשיו" persists; `recommendations` returns at least 5 items, none of them shelved; dismiss one and call again, it does not return;
   - user B cannot read user A's shelves through the REST API;
   - exits non-zero with a clear message on any failure.
2. Consolidate the Simania details helper duplicated in `recommendations/` with `_shared/simania.ts`.
3. Fix defects the gate exposes in any allowed file. A schema fix is a new migration, never an edit of an applied one. Do not weaken tests or constraints.

# Invariants

- This is the only S1 task that calls live external APIs. Keep the number of calls small.
- You may run `npm run test:db`. Do not start or stop the Supabase stack itself.
- If a failure is caused by an external API being down (for example NLI 502), report it; do not mask it.

# Acceptance criteria

1. All verification commands pass.
2. The script leaves no users, no running function server, and no stray data behind.
