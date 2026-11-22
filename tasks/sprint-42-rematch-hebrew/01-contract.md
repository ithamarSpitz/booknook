---
id: S42-T1
stage: 1
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on: []
allowed_paths:
  - docs/contract.md
context:
  - contract
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "if(!require('fs').readFileSync('docs/contract.md','utf8').includes('**Rematch Hebrew editions (S42).**'))throw new Error('missing')"
---

# Goal

`docs/contract.md` gets one general rule right after the S41 rules: **Rematch Hebrew editions (S42).** No book-specific constants.

`rematch:cached --hebrew` is a dry run over cached Hebrew editions that have no work (`simania_id > 0`, `work_id` null), in `simania_id` order, with optional `--offset`, `--limit`, `--min-hardcover` and `--force-hardcover`.
- For each edition, it runs the current resolver (`resolveMatch`).
- When a book is found and the edition's author agrees with the book's authors (the S40 rule, including its S41 addition), it prints a proposal line in the same format as normal `rematch:cached` proposals (`via: "hebrew"`).
- It never links anything. Proposals are applied with the existing `--from <file> --apply`, which checks the author agreement again.
- `--hebrew` cannot be combined with `--apply`, `--from` or `--hardcover-id`.

Measured on 2026-11-21:
- 176 cached Hebrew editions had no work. An independent check (Simania translator or NLI original title) confirmed 123 of them as translations.
- On 20 of those, the current resolver found 9 books, all correct.

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
