---
id: S13-T1
stage: 1
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/functions/_shared/hebrew-candidates.ts
  - tests/functions/hebrew-candidates.test.ts
  - tests/functions/fixtures/nli-author/**
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

The server's candidate list stops feeding rule G with ordinary words and broken author names, and a Wikidata rate limit no longer loses a book.

# Scope

Contract: "Catalog fallback for English-only books", the **G** bullet (stop list, NLI 100 author) and **Bounds** (Wikidata `429` retry). Reference: `tasks/sprint-13-fallback-g/reference-rule-g.probe.ts` (its `COMMON` set and the probe logic). The contract wins where they differ, and the probe is never imported.

`supabase/functions/_shared/hebrew-candidates.ts`:
1. `extractEnglishNames`: add the stop list (common words, at least the probe's `COMMON`, plus demonyms and review sources), compared case-insensitively. The title and author words stay excluded as now.
2. `parseNliMarc`: the 100 author uses only subfield `a`, and words containing a Latin letter are dropped.
3. Wikidata `429`: retry once after 2 seconds through the injected clock/sleep. The retry is outside the 4-request bound and still inside the 20-second deadline.

# Tests (`tests/functions/hebrew-candidates.test.ts`)

1. The Only One Left's description gives `english_names` with Lenora and Kit,, without Hope, Hung, End or Took.
2. Pretty Girls: Claire, Lydia, Julia and Atlanta are kept. Never Lie: Tricia, Ethan and Hale are kept, and Provided and Amazon are dropped.
3. A MARC 100 whose subfields are `ריילי` / `heb PreferredLanguageHeading` / `סאגר` (build the fixture so that subfield `a` is `סאגר, ריילי`) gives author `ריילי סאגר`.
4. Wikidata answers `429` and then `200`: rule D is still produced. `429` twice: rule D is dropped and the others are kept.
5. Existing tests still pass.

# Acceptance criteria

1. The behavior above; all tests pass.
