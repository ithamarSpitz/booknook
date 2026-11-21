---
id: S35-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');if(!t.includes('**Recheck fetches details before a relink (S35).**'))throw new Error('missing S35')"
---

# Goal

`docs/contract.md` corrects the S34 rule for `recheck:links --apply`.

Found in review of S34: `recheck:links --apply` writes the relinked work through `applyRepair` (`scripts/repair-links.ts`). That code upserts `similar_ids`, `tags` and the cover from the proposed book. After S34, a resolver match is built from search documents and has none of these fields, so a relink would write empty similar IDs and tags, and could overwrite an existing work's values.

# Scope

1. In "**Details only for a new work (S34).**", change the sentence about callers that only compare IDs to say: `verify:fallback` and the `recheck:links` dry run never fetch details.
2. Add after it: **Recheck fetches details before a relink (S35).**
   - Before `recheck:links --apply` writes a relink whose book was built from search documents, it fetches that book's details with one `books(where id in [id])` request, and writes those.
   - If that request fails or returns nothing, the relink is skipped and counted in `skipped`. The edition keeps its current link.

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
