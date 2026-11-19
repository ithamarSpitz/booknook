---
id: S20-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['### Large ID lists (S20)','selectInChunks','**Failed regeneration (browser, S20).**','העדכון האחרון של ההמלצות נכשל'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` states that database lookups by a list of IDs never put an unbounded list into one request. It also says a failed background regeneration is shown to the reader, not just logged.

# Protected-path permission (operator decision, 2026-11-19)

`docs/contract.md` is protected. Permitted: edits A and B below, word for word. Not permitted: any other change, or any other file. The reviewer must fail the task otherwise.

# Edits

## A. New subsection, inserted right before "### Simania runs in the browser"

### Large ID lists (S20)

Every Edge Function query that filters a column by a list of values (PostgREST `in`) sends at most 100 values per request, through the shared helper `selectInChunks` in `supabase/functions/_shared/chunked.ts`. The helper splits the list, runs the chunks at most 4 at a time, and concatenates their rows. Any chunk error fails the whole lookup, exactly like a single failed query today. Callers that relied on one query keep their behavior: the same rows, in any order, with no duplicates for distinct input values.

Measured 2026-11-19: one reader's `recommendations` call (about 250 rated books, so thousands of similar-book Hardcover IDs) answered `500` in 1.6 s with "error sending request ... /rest/v1/works?select=*&hardcover_id=in.(...)": the URL was too long. Her recommendations and genre shelves had not been regenerated since 2026-11-10.

## B. Browser, inserted right after the "**Refresh after removing or restoring (S16).**" paragraph

**Failed regeneration (browser, S20).** The background refresher (`public/js/recs-refresh.js`) remembers whether its last run failed: any error from the `recommendations` call or from localization. It exposes `failed()`, which is true after a failed run and false after a successful one; it starts false. Subscribers are notified of this state change as of a `busy` change. While `failed()` is true and no run is in progress, the Recommendations page (`#recs`) and the shelf settings page (`#genres`) show one status line at the top: "העדכון האחרון של ההמלצות נכשל. ננסה שוב בשינוי הבא." (`role="status"`). The console warning stays.

# Acceptance criteria

1. The diff is exactly edits A and B; `npm run check:contract` and the verification command pass.
