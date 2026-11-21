---
id: S33-T3
stage: 3
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S33-T2
allowed_paths:
  - supabase/functions/_shared/catalog.ts
  - tests/functions/prefix-weak.test.ts
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

`resolveMatch` (`supabase/functions/_shared/catalog.ts`) treats a prefix-only Wikidata match as weak. Contract: "**Prefix-only matches are weak (S33).**".

# Scope

- Add a small exported pure helper `isPrefixOnlyMatch(bridgeTitle, bookTitle)`:
  - it is true when `similarity(bridgeTitle, bookTitle) < 0.9` and `similarity(bridgeTitle, <bookTitle before its first colon>) >= 0.9`;
  - a title with no colon is never prefix-only.
  - Use the existing `similarity` from `utils.ts`.
- In `resolveMatch`, when the Wikidata step's match is prefix-only against the Wikidata bridge title, the existing NLI step also runs, exactly as it runs today (same hint and options).
  - If it finds a match that is not prefix-only against the NLI bridge title and that the guards accept, that match wins with status `nli`.
  - Otherwise the Wikidata match stays, with status `wikidata`.
- Everything else is unchanged: thresholds, guards, the box-set path, and the fuzzy step.

# Tests

New `tests/functions/prefix-weak.test.ts`, using the provider overrides that `resolveMatch` already accepts (no network):
1. Edition `המצפן הזהוב`. Wikidata gives `Northern Lights` / `Philip Pullman`, and its match is 1135414 `Northern Lights: Bolvangar`. NLI gives `Golden Compass`, and its match is 355708 `The Golden Compass`. The result is 355708 with status `nli`.
2. The same, but the NLI step finds nothing: the result is 1135414 with status `wikidata`.
3. The Wikidata match is `The Nickel Boys: A Novel` for bridge `The Nickel Boys`, and the NLI step finds the same book: the result is that book with status `wikidata`.
4. The Wikidata match is a full-title match: `nliOriginal` is never called (assert with a counter).
5. Unit tests for `isPrefixOnlyMatch`: true for (`Northern Lights`, `Northern Lights: Bolvangar`), false for (`Northern Lights`, `Northern Lights`), and false for a title with no colon.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
