---
id: S10-T5
stage: 3
model_class: worker
timeout_minutes: 35
review: true
allow_protected: true
depends_on:
  - S10-T2
  - S10-T4
allowed_paths:
  - scripts/verify-repair.ts
  - docs/architecture/functions.md
context:
  - contract
  - architecture.testing
  - architecture.functions
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
  - npm run verify:repair
---

# Goal

The live repair gate also proves, read-only against production, that the relinks are right and that correctly linked editions are no longer flagged.

# Scope

Extend `scripts/verify-repair.ts`. It stays read-only and keeps its existing cases and exit codes.

1. Relink cases, measured 2026-11-05. Each passes when the relink plan for the edition goes from the "now" id to the "to" id, or when the edition is already linked to a work whose `hardcover_id` is the "to" id (after the operator applied the repair).

   | simania_id | Hebrew title | now (wrong) | to |
   |---|---|---|---|
   | 981260 | הזמיר | 1912461 (עת הזמיר, Haim Be'er) | 212769 (The Nightingale, Kristin Hannah) |
   | 374138 | זודיאק | 149306 (Zodiac, Robert Graysmith) | 192875 (Zodiac, Neal Stephenson) |
   | 997264 | משכילה | 1018039 (Educated, Nellie Wilson) | 44186 (Educated: A Memoir, Tara Westover) |
   | 1009943 | רוחות הזעם | 606688 (Fury, Nicoli Gonnella) | 880804 (The Fury, Alex Michaelides) |

2. Not-flagged cases: `findAuthorMismatches` over production does not contain these editions:
   - 1027273 (Famesick, Lena Dunham)
   - 1028721 (Yesteryear, Caro Claire Burke)
   - 86443 (טווס בחדר מדרגות, a Hebrew original)
   - 810722 (1984, George Orwell)
   - 1002037 (ספריית חצות, Matt Haig, confirmed by its page)
3. No relink plan targets an edition outside the flagged findings. Print each relink plan.
4. Docs: in the "Operator scripts" paragraph of `docs/architecture/functions.md`, add one or two sentences on relinks:
   - Relinks move only flagged author mismatches with page evidence.
   - They are conditional on the old link.
   - `--apply` is run by the operator only.

# Acceptance criteria

1. `npm run verify:repair` passes on current production data, the docs are updated, and nothing is applied to production.
