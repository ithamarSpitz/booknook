---
id: S22-T4
stage: 3
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on:
  - S22-T2
  - S22-T3
allowed_paths:
  - docs/architecture/frontend.md
  - docs/architecture/testing.md
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const r=f=>require('fs').readFileSync('docs/architecture/'+f,'utf8');if(!r('testing.md').includes('audit:authors -- --all'))throw new Error('testing.md missing --all');if(!/no English author/i.test(r('frontend.md')))throw new Error('frontend.md missing guard exceptions')"
---

# Goal

The architecture docs describe S22 as merged.

# Scope

Read `public/js/hebrew-fallback.js`, `public/js/names.js` and `scripts/audit-authors.ts` first.

1. `frontend.md`, next to the S21 author guard text: the guard never rejects when there is no English author, or when the book is Hebrew-original.
2. `testing.md`, next to `audit:authors`: `npm run audit:authors -- --all` checks every linked edition.

# Protected-path permission (operator decision, 2026-11-20)

`docs/architecture/**` is protected. Permitted: these additions only. The reviewer must fail the task otherwise.

# Acceptance criteria

1. The docs match the merged code; `check:contract` and the verification command pass.
