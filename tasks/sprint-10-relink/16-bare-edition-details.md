---
id: S10-T16
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - public/js/recs.js
  - tests/web/recs.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

A recommended or genre-shelf Hebrew book whose edition was stored without Simania details shows its cover, rating and description when opened, and keeps them afterwards.

# Bug (production, 2026-11-05)

Yael's genre shelf `מותחנים` has 1024882 `הסוד של עוזרת הבית`. The tile shows the English Hardcover cover: `cover_url` falls back to `works.hardcover_cover_url`. The card shows no image, no rating ("אין עדיין דירוגים בסימניה") and no description.

The edition row was first inserted as a `match-by-author` candidate, which stores only `simania_id`, `title` and `author` with `details_at` null. Edge Functions cannot reach Simania (Cloudflare `403`), so `book-details` called with only `simania_id` cannot fill it in. `openRecommendationCard` in `public/js/recs.js` never sends a `simania` payload. `book-details` already accepts one (contract: `book-details`, request "optionally with `simania` as for `add-book`") and stores it.

# Scope

Contract: `book-details`, **Bare editions (browser)**. In `public/js/recs.js` `openRecommendationCard`:

1. After the existing `book-details { simania_id }` call for a positive `simania_id`: when the returned `book` has `cover_url`, `description` and `simania_rating` all null, call `fetchSimaniaPayload(simania_id)` (from `public/js/simania.js`, injectable through `deps` for tests). When it returns a payload, call `book-details { simania_id, simania: payload }` and use that result's `book`.
2. Any failure in step 1, or a null payload, keeps the first `book` silently. Respect `deps.isCurrent()` between the awaits, as the function already does.
3. At most once per open. A book with any of those fields set triggers no Simania call.
4. Nothing else changes: the English-only path, actions, chrome and reason line stay as they are.

# Tests (`tests/web/recs.test.mjs`, fakes only)

1. A bare book: the payload is fetched, the second `book-details` call carries `simania`, and the card opens with the second result (its `cover_url`).
2. A book with a cover: no payload fetch and one `book-details` call.
3. The payload fetch throws: the card opens with the first result and no toast.
4. A card replaced while the payload is loading (`isCurrent` false) does not open.

# Acceptance criteria

1. The behavior above; all tests pass.
