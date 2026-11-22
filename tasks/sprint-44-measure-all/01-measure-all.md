---
id: S44-T1
stage: 1
model_class: worker
timeout_minutes: 40
review: true
allow_protected: true
depends_on: []
allowed_paths:
  - scripts/measure-links.ts
  - tests/functions/measure-links.test.ts
  - docs/contract.md
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - npm run check:contract
  - >-
    node -e "if(!require('fs').readFileSync('docs/contract.md','utf8').includes('**Measure all cached (S44).**'))throw new Error('contract')"
---

# Goal

`measure:links` measures only in-use works today. The real target is **all cached works**. Add `--all` and `--sample <n>` to `scripts/measure-links.ts`, and write the rule in `docs/contract.md` right after **Link measurement (S43)**, under the exact bold name **Measure all cached (S44).**

**`--all`:**
- Switches the population from in-use works to every row in `public.works`.
- `unlinked` means works with no edition where `simania_id > 0`, the same as the S43 definition.
- The check for each work is the same as for in-use works.

**`--sample <n>`** (only allowed with `--all`):
- Checks every k-th unlinked work in `works.id` order, where k is the unlinked count divided by n, rounded down and at least 1, until n are checked. Use the same sampling helper as `--wrong`.
- The printed JSON becomes:

```json
{"all_works":3900,"unlinked":1767,"sampled":400,"missed_in_sample":9,"failed":4,"missed_estimate":40,"missed_rate":0.0103,"missed_titles":["..."]}
```

- `missed_estimate` is `round(missed_in_sample * unlinked / sampled)`.
- `missed_rate` is `missed_estimate / all_works`.

Without `--all`, the output stays exactly as it is now. `--hebrew` and `--wrong` keep working, and can be combined with `--all`.

# Acceptance criteria

1. Tests with fakes cover:
   - the population switch;
   - sampling (10 unlinked works with n=3 checks works 1, 4 and 7, counting from 1);
   - the estimate arithmetic;
   - `--sample` without `--all` is rejected.
2. Existing measure-links tests pass unchanged.
3. All verification commands pass.
