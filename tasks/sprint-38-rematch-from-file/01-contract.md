---
id: S38-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');if(!t.includes('**Rematch apply from a dry run (S38).**'))throw new Error('missing')"
---

# Goal

`docs/contract.md` gets one general S38 rule, next to "**Rematch cached works (S37).**". It has no book-specific constants.

Measured on 2026-11-21:
- The S37 dry run over 2,290 works takes about 150 minutes with 3 workers. About 345 works are expected to get a proposal.
- Re-running with `--apply` would repeat every search and confirmation: about 4 Hardcover calls per proposal, 1,380 calls, while about 820 were left that day.
- Also, 1 of 3 parallel workers exited 3 at startup because the batched Wikidata author lookup failed once. A single lookup a minute later succeeded.

# Scope

**Rematch apply from a dry run (S38).**
- A `rematch:cached` proposal line also has `book_id`, the Hardcover id of the confirmed book.
- At startup, a failed `wikidataHebrewAuthors` is retried up to 2 more times, 30 seconds apart, before exit 3.
- `rematch:cached -- --from <file> [--apply]` links the proposals in a saved dry-run output without searching or confirming again:
  - It reads the JSON lines that have `proposal.book_id` and ignores all other lines.
  - An edition that is linked to a work by now is skipped as `linked_elsewhere`.
  - The Hardcover books are fetched with `hardcoverBooks` in chunks of at most 50 ids, so one request covers 50 proposals. A missing book is skipped as `details_failure`.
  - A missing edition row is created from Simania details, as in S37.
  - The link uses the saved `status`.
  - Without `--apply`, it only prints what it would link.
  - `--from` can't be combined with `--hardcover-id`, `--offset`, or `--limit`.

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
