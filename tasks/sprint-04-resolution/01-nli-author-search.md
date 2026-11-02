---
id: S4-T1
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/functions/_shared/bridges.ts
  - tests/functions/nli-original.test.ts
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

`nliOriginal` finds the right NLI record when a plain title search is flooded with unrelated records, by searching with the author's surname first.

# Why (live evidence, Nov 2026)

`alma.title all "הדירה בפריז"` returns 316 NLI records (mostly archive files); the real book is not in the first 25, so `nliOriginal` returns null. `alma.title all "הדירה בפריז" AND alma.creator all "פולי"` returns exactly 1 record: 245 "הדירה בפריז /", 100 "פולי, לוסי", 240 "Paris apartment.".

# Scope

In `supabase/functions/_shared/bridges.ts` only (`nliOriginal` and its private search helper):

1. Surname: from the Simania author hint, take the text before the first comma, trim, take its last whitespace-separated word, remove `"` and `\`. Example: "לוסי פולי" → "פולי". Empty author → no surname.
2. When there is a surname, first run one SRU search with query `alma.title all "<clean title>" AND alma.creator all "<surname>"` (same `version`, `operation`, `maximumRecords=25`, `recordSchema=marcxml`, timeout and headers as today). Apply the existing record rules (Hebrew-title Dice at least 0.78, original title candidates, ranking) to its records. If a record is accepted, return it.
3. Otherwise (no surname, no accepted record) run the existing plain `alma.title all "<clean title>"` search and apply the same rules, exactly as today.
4. A provider failure (network error, timeout, non-2xx) still throws, as today, so the caller can keep the edition `pending`. Keep the signature `nliOriginal(hebrewTitle, hebrewAuthor = "")` and the `Bridge` result shape.

Do not change `nliHebrew`, Wikidata code, or anything else.

# Tests

New file `tests/functions/nli-original.test.ts` with a stubbed `fetch` (no live calls), MARC XML fixtures written inline:

1. Author given: the first request's `query` parameter is `alma.title all "הדירה בפריז" AND alma.creator all "פולי"`; its record (240 "Paris apartment.") is returned as `{ title: "Paris apartment", author: "פולי, לוסי", source: "NLI" }` and only one request is made.
2. Author search returns zero records: a second request with the plain title query is made and its accepted record is returned.
3. Empty author: only the plain title query is made.
4. Author with a comma ("לוסי פולי, קטיה בנוביץ'") uses surname "פולי".
5. A non-2xx response throws.

# Acceptance criteria

1. The behavior above, with all tests passing.
2. At most 2 NLI requests per `nliOriginal` call.
