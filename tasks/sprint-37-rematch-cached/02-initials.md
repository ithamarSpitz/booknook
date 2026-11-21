---
id: S37-T2
stage: 2
model_class: worker
timeout_minutes: 30
review: true
depends_on:
  - S37-T1
allowed_paths:
  - supabase/functions/_shared/names.ts
  - public/js/names.js
  - tests/functions/name-initials-s37.test.ts
  - tests/web/name-initials-s37.test.mjs
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - npm run test:web
---

# Goal

Contract: "**Initials in name sound (S37).**". `nameSoundScore` ignores a Latin middle initial that the Hebrew name lacks.

# Scope

In both `supabase/functions/_shared/names.ts` and `public/js/names.js`, with the same algorithm in each:
- For each Latin name, also score a copy with every single-letter initial token removed. A token is one Latin letter, optionally followed by `.`; tokens are split on spaces and also on `.` between initials, as in `J.K.`.
- Use the higher score.
- Do not remove anything when that would leave no token.

# Tests

New `tests/functions/name-initials-s37.test.ts` (server) and `tests/web/name-initials-s37.test.mjs` (browser), with the same cases. Scores were measured on 2026-11-21, before the change.
1. `nameSoundScore("שרי טפר", ["Sheri S. Tepper"]) >= 0.9`. It was 0.67.
2. `nameSoundScore("אורסולה לה גווין", ["Ursula K. Le Guin"]) >= 0.66`. It was 0.55; without the initial it is 0.67.
3. `nameSoundScore("ג'ורג' מרטין", ["George R. R. Martin"]) >= 0.9`. It was 0.77.
4. These stay at `1`: `("שרי ס. טפר", ["Sheri S. Tepper"])`, `("ג'יי קיי רולינג", ["J.K. Rowling"])`, `("ג'ורג' ר. ר. מרטין", ["George R. R. Martin"])`, `("רוברט מ. פירסיג", ["Robert M. Pirsig"])`.
5. `nameSoundScore("מילן קונדרה", ["Louis Sachar"]) <= 0.3`. Different people stay apart.

All existing name-sound tests (S21 pairs and the rest) pass unchanged.

# Acceptance criteria

1. The behavior above; all three verification commands pass.
