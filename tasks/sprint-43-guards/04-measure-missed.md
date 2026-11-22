---
id: S43-T4
stage: 2
model_class: worker
timeout_minutes: 40
review: true
allow_protected: true
depends_on:
  - S43-T1
allowed_paths:
  - scripts/measure-links.ts
  - package.json
  - tests/functions/measure-links.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - >-
    node -e "if(!require('./package.json').scripts['measure:links'])throw new Error('measure:links')"
---

# Goal

Implement the missed-translation part of **Link measurement (S43)** as `scripts/measure-links.ts`. Add `npm run measure:links` with the same deno flags as `rematch:cached`.

Our working code is in `tasks/sprint-43-guards/examples/`. Port it, don't reinvent it:
- **`m6.ts`** has the in-use query. It lists in-use works with no linked Hebrew edition.
- **`verifyFull2.ts`** is the independent check. For each such work:
  - it finds the Hebrew author;
  - it lists that author's unlinked Simania books;
  - it bridges each one back through `nliOriginal` / `wikidataOriginal`;
  - a candidate whose original matches the English title (similarity ≥ 0.6, with the strip) counts as a missed translation.

  Keep its Wikimedia throttle (one request at a time, at least 300 ms apart, retry on 429).

The script opens the DB with `openProdDb({ readOnly: true })`. It prints:

```json
{"in_use_works":489,"unlinked_in_use":91,"missed":12,"missed_rate":0.0245,"missed_titles":["Catching Fire"]}
```

Put the per-work decision in an exported function that takes its providers as arguments, so tests can fake them.

# Acceptance criteria

1. `tests/functions/measure-links.test.ts` tests that function with fakes:
   - a work whose author has a Simania book whose NLI original equals the English title → missed;
   - one whose candidates' originals differ → not missed;
   - one where the providers throw → not missed, and counted in a `failed` field.
2. No Hardcover calls and no writes.
3. All verification commands pass.
