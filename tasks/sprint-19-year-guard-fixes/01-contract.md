---
id: S19-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['Simania uses 0 for an unknown year','originalYearOf','Don Quixote (Miguel de Cervantes Saavedra) | 183461','not JSON objects are ignored'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` fixes two S18 mistakes found in the operator check on 2026-11-19:
- the year guard treated Simania's year 0 (unknown) as a real year, and so dropped the correct Don Quixote link;
- the review script never received `original_year`, so the guard never ran in the review.

# Protected-path permission (operator decision, 2026-11-19)

`docs/contract.md` is protected. This task may change it only with edits A-D below, word for word.

Not permitted: any other change to `docs/contract.md`, or any other file. The reviewer must fail the task if the diff changes anything else.

# Edits

## A. Year guard

In the step starting "3a. **Year guard (S18).**", replace "whose `year` is a number below `original_year − 1`." with "whose `year` is a positive number below `original_year − 1` (S19: Simania uses 0 for an unknown year, so 0, negative and missing years never trigger the guard; measured 2026-11-19: 183461 דון קישוט has year 0)."

## B. Shared year helper

In the line starting "- Request `HebrewCandidatesRequest`", after the sentence that defines `original_year`, add: "Both the handler and the operator scripts compute it with the shared `originalYearOf(book)` in `supabase/functions/_shared/hebrew-candidates.ts` (S19): the book's `release_year` when it is a positive integer, otherwise null."

## C. Review script parity

In "**Population review.**", replace "A book that still fails is printed with `errors`, as before." with "A book that still fails is printed with `errors`, as before. In every mode the script passes `original_year` (from `originalYearOf` on the Hardcover book it already loads) to `localizeFallback`, exactly as the browser gets it from `hebrew-candidates`, so the year guard runs in the review (S19; before, it was missing and the review could not see the guard)."

In the "`--compare`" bullet, replace "It reads two outputs of the same mode" with "It reads two outputs of the same mode (lines that are not JSON objects are ignored, for example tool install messages)".

## D. Known cases

In the table of expected links (the rows such as "| Never Lie (Freida McFadden) | 1029088 | G |"), add a row after the Never Lie row:

| Don Quixote (Miguel de Cervantes Saavedra) | 183461 | F (Simania year 0; S19) |

# Acceptance criteria

1. The diff is exactly edits A-D; `npm run check:contract` and the verification command pass.
