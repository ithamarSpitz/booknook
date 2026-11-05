---
id: S10-T2
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S10-T1
allowed_paths:
  - scripts/lib/link-proposal.ts
  - tests/functions/link-proposal.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

The link proposal uses the author name printed on the Simania page, and accepts Hardcover titles that carry a subtitle.

# Scope

Contract: "Operator scripts: catalog audit and link repair", **Link proposal**. In `scripts/lib/link-proposal.ts` (`proposeLink`):

1. Read the page with `pageOriginal` (S10-T1) instead of `pageOriginalTitle`.
2. English author: the page `author` when it is non-null, and then `wikidataEnglishAuthor` is **not called**; otherwise `wikidataEnglishAuthor(edition.author ?? "")` as today. `LinkProposal.english_author` holds whichever was used.
3. Title score per candidate: `max(similarity(originalTitle, book.title), similarity(originalTitle, mainTitle(book.title)))`. `mainTitle` is the part before the first `: ` (the whole title when there is none). The candidate threshold stays `0.9`. The tie-break and all other rules are unchanged.

# Tests (add to `tests/functions/link-proposal.test.ts`, fakes only)

Model the fakes on production data measured on 2026-11-05. Keep the existing tests passing unchanged.

1. Educated (997264, `טארה וסטאובר`): the page is `Educated / Tara Westover`. Candidates:
   - 44186 `Educated: A Memoir` by Tara Westover and Julia Whelan, `users_read_count` 2168
   - 1018039 `Educated` by Nellie Wilson
   - 802966 `Educated` by Sabrina Kade

   Expect 44186, `ok`, `english_author` `Tara Westover`, and the fake `wikidataEnglishAuthor` never called.
2. Midnight Library (1002037, `מאט הייג`): the page is `The Midnight Library / Matt Haig`; candidate 428018 by Matt Haig. Expect 428018, `ok`.
3. Page without an author → Wikidata is called, as before.

# Acceptance criteria

1. The behavior above; all tests pass.
