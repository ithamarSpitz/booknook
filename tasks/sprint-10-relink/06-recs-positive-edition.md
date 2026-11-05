---
id: S10-T6
stage: 1
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/functions/recommendations/index.ts
  - tests/functions/recommendations-handler.test.ts
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

A recommendation never points at an English edition, so an English-only card on the recommendations page can be added to a shelf again.

# Bug (production, 2026-11-05)

Opening an English-only book (a genre shelf, or search) runs `book-details` with `simania_id = -hardcover_id`. That stores an English edition (negative ID) linked to the work. On the next run, `linkedEdition()` in `supabase/functions/recommendations/index.ts` picks the lowest `simania_id` linked to the work without a positive-ID filter, so it picks the English edition.

The card then has `simania_id: -474156` and `english_only: false`. The browser posts `add-book { simania_id: -474156 }`, and `add-book` rejects it with `400`. Itamar's recommendations Before Mars (`-474156`) and Dawn (`-104531`) were in this state, and 2 genre rows too.

The genre path (step 5) already filters `simania_id > 0`.

# Scope

Contract: "Linking a localized edition" (last sentence) and the `recommendations` table (`simania_id` is null or positive).

1. `linkedEdition()` considers only editions with `simania_id > 0`. With none, the card is English-only (null `simania_id`, a Hebrew hint as today). Keep the existing ordering among positive editions.
2. Check the rest of `supabase/functions/recommendations/index.ts` for any other place that turns an edition linked to a work into a recommendation or genre `simania_id`. Make each one positive-only, and list them in your report.

# Tests (add to `tests/functions/recommendations-handler.test.ts`, fakes only)

1. A candidate work whose only linked edition is English (`-474156`) gives a replacement row with `simania_id: null`, and the card is `english_only: true`.
2. A candidate work with both an English edition (`-474156`) and a Hebrew edition (`1234`) gives `1234`.
3. The existing tests keep passing.

# Acceptance criteria

1. The behavior above; all tests pass.
