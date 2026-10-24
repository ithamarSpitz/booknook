---
id: S0-T1
stage: 1
model_class: hard_worker
timeout_minutes: 40
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - docs/contract.md
  - supabase/functions/_shared/types.ts
  - supabase/functions/_shared/db.ts
  - public/js/contract.js
context:
  - assignment
  - architecture.overview
  - architecture.data_model
  - architecture.functions
  - architecture.frontend
environment: null
verification:
  - npm run check:contract
  - npm run check:functions
  - node --check public/js/contract.js
---

# Goal

Write the binding interface between the parallel lanes of sprint S1: every table row shape, every Edge Function request and response, every RPC signature, and the web constants. A human reviews this before S1 starts.

# Required context

- `docs/architecture/data-model.md`, `functions.md`, `frontend.md`.
- Existing `supabase/functions/_shared/simania.ts` and `hardcover.ts` for the real `SimaniaBook` and `HardcoverBook` shapes. Reuse those types; do not invent fields Simania or Hardcover do not return.

# Scope

1. `docs/contract.md`: for each table, the final column list with types, nullability and defaults; enum values; RLS summary; each RPC (`move_book`, `move_shelf`, `delete_shelf`, `remove_book`) with parameters, return value, errors; the `handle_new_user` trigger; each function (`search-books`, `add-book`, `book-details`, `recommendations`) with request, response, status codes and error cases; the `BookCard` and `RecommendationCard` view models and which column fills each field; the web module contract (`mount(root, ctx)`, routes, file ownership per lane). Use JSON examples.
2. `supabase/functions/_shared/types.ts`: exported TypeScript types matching the document. Names checked by `scripts/check-contract.mjs`: `ShelfKind`, `ResolveStatus`, `ProfileRow`, `WorkRow`, `EditionRow`, `ShelfRow`, `ShelfBookRow`, `RecommendationRow`, `SimaniaBook`, `BookCard`, `RecommendationCard`, `ErrorResponse`, and `*Request` / `*Response` for SearchBooks, AddBook, BookDetails, Recommendations. Re-export `SimaniaBook` from `simania.ts` if it fits rather than duplicating it.
3. `supabase/functions/_shared/db.ts`: `serviceClient()` and `userClient(req)` factories using `npm:@supabase/supabase-js@2.45.4` and the standard `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` env vars, plus `requireUser(req)` that returns the user id or throws `HttpError(401)`.
4. `public/js/contract.js`: `export const SHELF_KINDS`, `FUNCTIONS` (function names), `ROUTES` (hash routes), `RPCS` (RPC names and parameter names). JSDoc typedefs for `BookCard` and `RecommendationCard`.

# Out of scope

Migrations, function implementations, UI. Do not change existing function behavior.

# Invariants

- Matches `docs/architecture/**`. Where the architecture leaves a detail open, decide it and write the decision in the contract. Where you believe the architecture is wrong, stop and report.
- No secrets anywhere in `public/`.

# Acceptance criteria

1. Every table, function, RPC and type listed above appears in the contract and in `types.ts`.
2. `deno check` passes for all functions with the new files.
3. A developer could implement any one lane from the contract alone.
