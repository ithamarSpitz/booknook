---
id: S31-T4
stage: 3
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S31-T2
  - S31-T3
allowed_paths:
  - supabase/functions/_shared/catalog.ts
  - tests/functions/box-sets.test.ts
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

`resolveMatch` in `supabase/functions/_shared/catalog.ts` follows "**Box sets (S31).**". Put no book-specific constants in the code. The word lists are the generic ones from the contract.

# Scope

- Export `isBoxSet(matchTitle)` and `boxCore(matchTitle)`, pure, exactly as the contract defines them.
- In `resolveMatch`, when `isBoxSet(titleForMatch)`:
  - run the Wikidata and NLI bridges on `boxCore(titleForMatch)` instead (the series prefix rule still applies to that core);
  - for each accepted bridge title, try `api.findHardcoverBook("<bridge title> Trilogy" | "... Collection" | "... Box Set", hint, { requireAuthor: true, boxTitle: true })` in that order, and stop at the first book that passes the author guard;
  - skip the direct fuzzy fallback;
  - with nothing accepted, return `null`.
- Non-box-set editions are unchanged.

# Tests

New `tests/functions/box-sets.test.ts`, with provider overrides and no network:
1. `isBoxSet`:
   - true for `טרילוגיית משחקי הרעב`, `מארז דיגיטלי – מורשת הותורן` and `טרילוגיית חמישים גוונים של אפור - סט מלא`;
   - false for `אידיוט`, `סטודיו` and `הסטודנטית` (substrings only), and for `התלקחות - משחקי הרעב 2`.
2. `boxCore`:
   - `טרילוגיית משחקי הרעב` gives `משחקי הרעב`;
   - `מארז דיגיטלי – מורשת הותורן` gives `מורשת הותורן`;
   - `טרילוגיית חמישים גוונים של אפור - סט מלא` gives `חמישים גוונים של אפור`.
3. **Hunger Games box.** Wikidata for `משחקי הרעב` gives `{ title: "The Hunger Games", author: "Suzanne Collins" }`.
   - The `findHardcoverBook` stub returns 593165 only for the query `The Hunger Games Trilogy` with `boxTitle: true`, and `null` otherwise.
   - The result is 593165 with status `wikidata`.
   - The calls used `boxTitle: true`.
4. When all three queries return `null`, the result is `null` and no fuzzy call is made.
5. A non-box edition makes exactly the same calls as before S31 (compare the call list with an S30-style expectation).

# Acceptance criteria

1. The behavior above; both verification commands pass.
