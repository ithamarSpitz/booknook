---
id: S34-T1
stage: 1
model_class: worker
timeout_minutes: 20
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Search-only ranking (S34).**','**Details only for a new work (S34).**'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes how Hardcover matching uses fewer requests, with the same decisions.

Measured on prod on 2026-11-21:
- Each Hardcover search costs 2 requests: `search` for the IDs, then `books(where id in …)` for details of all 8 results.
- The search `results` documents already have every field the ranking uses: `id`, `title`, `alternative_titles`, `contributions[].author.name`, `users_read_count`, `image` and `slug`.
- An A/B test ran `resolveMatch` on 150 used links two ways: with the details call, and with books built only from the search documents. All 149 that completed gave the same book and status; 1 failed on a provider in the details run. Building from the documents needed no details requests.

# Scope

In step 3 (**Hardcover match**), add:
1. **Search-only ranking (S34).**
   - Hardcover matching builds each candidate from the search `results` documents. The title is `title`, contributors come from `contributions[].author.name` in order, and readers come from `users_read_count`. `image` and `slug` are copied over. It does not call `books(where …)` while matching.
   - If the response has no documents for its IDs, matching falls back to the details request for those IDs, as before.
2. **Details only for a new work (S34).**
   - When the resolver writes a work for a match built from search documents, it first fetches that one book's details with one `books(where id in [id])` request and writes those fields (similar IDs, tags, cover).
   - If that request fails, it counts as a provider failure: the edition stays `pending` and no work is written.
   - Callers that only compare IDs (`recheck:links`, `verify:fallback`) never fetch details.

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
