---
id: S43-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const k of ['**Provider failure detail (S43).**','**English original mismatch (S43).**','**Link measurement (S43).**'])if(!t.includes(k))throw new Error(k)"
---

# Goal

`docs/contract.md` gets three general rules right after the S42 rule, with these exact bold names. No book-specific constants.

**Provider failure detail (S43).**
- Every `rematch:cached` skip line with `"skipped":"provider_failure"` also has `"failures":[{"provider":"<name>","error":"<message>"}]`.
- There is one entry per failed call.
- `provider` is one of: `hardcover`, `simania`, `wikidata`, `nli`, `wiktionary`, `sound`, `db`.
- `error` is the error message, cut to 200 characters.

**English original mismatch (S43).**
Before `rematch:cached` prints a proposal, or links one with `--from … --apply`, it asks NLI for the original title of the Simania book (`nliOriginal(hebrew title, hebrew author)`). It rejects the proposal with the skip reason `nli_english_mismatch` when all three of these hold:
1. The NLI title contains an English function word (`of`, `the`, `and`, `to`, `in`, `on`, `with`, `for`, `a`, `an`) as a whole word.
2. Its similarity to the work's title is below 0.6. Similarity is the max of `similarity(a, b)` and `similarity` of both titles with any parenthesized part, anything after a colon and a leading "The" removed.
3. It does not contain every word of the work's title. A word here means lowercased, accents removed, longer than 2 letters, and not `the` or `and`.

If NLI returns nothing or fails, the proposal is not rejected.

Measured on 2026-11-22, on 30 proposals where NLI's original disagreed with the match:
- The rule rejects 2 of the 3 wrong ones.
- It rejects 0 of the 27 correct ones.

**Link measurement (S43).**
`npm run measure:links` is read-only. It never writes to the database and makes no Hardcover requests. It prints one JSON line:
- In-use works are those in `recommendations`, `genre_recommendations` or on a shelf.
- The missed-translation count is in-use works with no linked Hebrew edition for which an independent check (NLI or Wikidata original of a Simania book by the same author) finds a Hebrew translation.
- With `--wrong <n>`, it also prints a sample of n linked in-use works, each checked through NLI's original title as `agree`, `differ` or `unknown`.

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
