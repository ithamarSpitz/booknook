---
id: S7-T6
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S7-T3
allowed_paths:
  - supabase/functions/recommendations/index.ts
  - supabase/functions/_shared/catalog.ts
  - tests/functions/recommendations-handler.test.ts
  - tests/functions/helpers/fake-db.ts
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

Recommendations work with English editions: every card can be added (English-only cards as their English edition), English editions are never sent through Hebrew resolution, and book cards say when they are English editions.

# Scope

1. `supabase/functions/recommendations/index.ts`:
   - Every card gets `hardcover_id` (the work's `hardcover_id`) and `can_add: true` (contract `RecommendationCard`).
   - Self-healing never selects editions with a negative `simania_id`.
   - English editions on the caller's shelves are seeds like any linked edition (they have `work_id`); make sure nothing filters them out, and `because_titles` uses their title.
2. `supabase/functions/_shared/catalog.ts`: `bookCard(...)` sets `english_edition: simania_id < 0`; `ensureResolved` returns a negative-ID edition unchanged without any provider call (defensive guard).

# Tests (`tests/functions/recommendations-handler.test.ts`, keep existing ones)

1. English-only and localized cards both have `can_add: true` and the right `hardcover_id`.
2. A shelved English edition (`simania_id -383752`, linked) seeds recommendations and appears in `because_titles`.
3. Self-healing skips a negative-ID edition even if it is `pending`.
4. `ensureResolved` on a negative ID makes no provider call.

# Acceptance criteria

1. The behavior above; all tests pass.
