---
id: S50-T2
stage: 2
model_class: worker
timeout_minutes: 30
review: true
depends_on:
  - S50-T1
allowed_paths:
  - scripts/check-run-health.ts
  - tests/functions/check-run-health.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Implement **Run health formats (S50)**. Spend few tokens.

On 2026-11-25, `check:run-health` called a good in-use `measure:links` output "unhealthy: no works summary in last JSON line", because it only knew the `--all --sample` format. The in-use format's last line looks like this:

```json
{"in_use_works":488,"unlinked_in_use":92,"missed":3,"hebrew_label_unconfirmed":3,"no_evidence":71,"failed":15,"missed_rate_low":0.0061,"missed_rate_high":0.043}
```

Recognize it by `unlinked_in_use`. It is unhealthy when `failed * 2 > unlinked_in_use`. If an `--all` measure output has a `hebrew` block, apply the Hebrew rule to it too.

# Acceptance criteria

1. Tests cover:
   - the line above → healthy;
   - the same line with `failed: 50` → unhealthy;
   - every existing case, unchanged.
2. Both verification commands pass.
