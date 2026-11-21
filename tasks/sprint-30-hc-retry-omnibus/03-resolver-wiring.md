---
id: S30-T3
stage: 3
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S30-T2
allowed_paths:
  - supabase/functions/_shared/catalog.ts
  - tests/functions/resolver-s30.test.ts
  - tests/functions/hardcover-match.test.ts
  - tests/functions/author-hint.test.ts
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

`ensureResolved` in `supabase/functions/_shared/catalog.ts` uses the S30-T2 options and the series-prefix NLI retry. Contract paragraphs: "**Hardcover author retry (S30).**", "**Hebrew author sound (S30).**" and "**Series prefix (S30).**".

# Scope

1. Wikidata bridge match: call `api.findHardcoverBook(bridge.title, bridge.author, { retryWithAuthor: true })`.
2. NLI bridge match:
   - call `api.findHardcoverBook(bridge.title, hint ?? bridge.author, options)`;
   - `options` is `{ retryWithAuthor: true }`;
   - when `hint` is null (no catalog hint, `verso author` or Wikidata author), it also has `soundAuthor: edition.author ?? ""`.
3. The direct fuzzy fallback call is unchanged: `{ requireAuthor: true }` only.
4. Series prefix: when `api.nliOriginal(titleForMatch, author)` returns `null`, call it once more with the rest of the title, but only when:
   - `edition.series?.trim()` is non-empty;
   - `titleForMatch` starts with `<series> - ` or `<series> – `;
   - the trimmed rest is non-empty and does not match `/^(כרך|ספר|חלק)\s*\S+$/`.

   Use the second result as the bridge. Everything after it is unchanged.
5. Change nothing else.

Existing tests that assert the exact `findHardcoverBook` arguments of the bridge calls may need the new options added. Change only those expectations.

# Tests

New file `tests/functions/resolver-s30.test.ts`, in the style of the `ensureResolved` tests in `tests/functions/hardcover-match.test.ts` (FakeDb plus provider overrides; no network):

1. Wikidata bridge `{ title: "Wild", author: "Cheryl Strayed" }`: the `findHardcoverBook` call has `{ retryWithAuthor: true }`.
2. An NLI bridge with no hint source: the Simania author is `אלכס מורל`, `nliOriginal` gives `{ title: "Survive", author: "מורל, אלכס" }`, and `wikidataEnglishAuthor` gives `null`. The call is `("Survive", "מורל, אלכס", { retryWithAuthor: true, soundAuthor: "אלכס מורל" })`.
3. An NLI bridge with a `versoAuthor`: the options have no `soundAuthor`.
4. The fuzzy call still gets exactly `{ requireAuthor: true }`.
5. Series prefix: title `הגן הכימי - הקמילה`, series `הגן הכימי `. `nliOriginal` returns `null` for the full title and `{ title: "Wither", ... }` for `הקמילה`. The calls are, in order, the full title then `הקמילה`, and the Hardcover match uses `Wither`.
6. Title `יומני רובורצח - כרך 1`, series `יומני רובורצח`: exactly one `nliOriginal` call.
7. A full-title NLI hit: no second `nliOriginal` call.
8. Series null or empty: no second call.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
