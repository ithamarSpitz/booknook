---
id: S43-T5
stage: 3
model_class: worker
timeout_minutes: 30
review: true
depends_on:
  - S43-T4
allowed_paths:
  - scripts/measure-links.ts
  - tests/functions/measure-links.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Add `--wrong <n>` to `scripts/measure-links.ts`, as described in **Link measurement (S43)**.

1. Take every in-use work that has a linked Hebrew edition (`editions.simania_id > 0`), ordered by `works.id`. Keep every k-th one, where k is the count divided by n, rounded down and at least 1, until n are kept.
2. For each kept work, run the check in `tasks/sprint-43-guards/examples/spot-all.ts`:
   - get `bookDetails(simania_id)`;
   - get `nliOriginal(hebrew title, hebrew author)`;
   - compare the result with the work title (similarity ≥ 0.6 with the strip): `agree` if it matches, `differ` if not, `unknown` if NLI gives nothing.
3. Add `"wrong_sample":{"n":40,"agree":30,"differ":4,"unknown":6,"differ_titles":[["English","NLI original"]]}` to the printed JSON.

Put the per-link decision in an exported function with injectable providers.

# Acceptance criteria

1. Tests with fakes cover `agree`, `differ` and `unknown`, and cover the sampling step (10 works with n=3 keeps works 1, 4 and 7, counting from 1).
2. Both verification commands pass.
