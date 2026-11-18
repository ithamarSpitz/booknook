---
id: S16-T3
stage: 2
model_class: worker
timeout_minutes: 20
review: true
allow_protected: true
depends_on:
  - S16-T1
allowed_paths:
  - docs/architecture/frontend.md
context:
  - contract
  - architecture.frontend
environment: null
verification:
  - npm run check:contract
---

# Goal

The frontend architecture doc describes the S16 book card order and the refresh after removing or restoring.

# Scope

Contract: "Book card layout (S16)" and "Refresh after removing or restoring (S16)".

1. The `**Book card**` bullet: list the parts in the S16 order. Actions sit below the ratings and the details after the description, and the library remove button reads "הסר".
2. The `**Recommendations**` bullet: add one short sentence saying that "הסר", "לא הסגנון שלי" and "החזר" start a background regeneration.

# Protected-path permission (operator decision, 2026-11-18)

`AGENTS.md` forbids editing `docs/architecture/**`. This task is the one exception, and the exception is narrow.

Permitted:
- Editing exactly one file, `docs/architecture/frontend.md`.
- Only the two bullets named in Scope.

Not permitted:
- Any other file under `docs/architecture/**`.
- `ARCHITECTURE.md`, `docs/assignment.md`, `docs/contract.md`, `design/**` and `prototype/**`.
- Any file outside `allowed_paths`.
- Rewording, reformatting or removing any other text in the file.
- Describing behavior the contract does not state.

The reviewer must fail the task if the diff touches anything outside "Permitted".

# Acceptance criteria

1. The two bullets match the contract; `npm run check:contract` passes.
2. `git diff --stat` shows only `docs/architecture/frontend.md`.
