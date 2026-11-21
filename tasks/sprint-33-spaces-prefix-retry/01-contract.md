---
id: S33-T1
stage: 1
model_class: worker
timeout_minutes: 20
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Collapsed spaces (S33).**','**Prefix-only matches are weak (S33).**','**Recheck retries provider failures (S33).**'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes three general S33 rules. They have no book-specific constants.

Measured on prod on 2026-11-21 by the `recheck:links` dry run (not applied):
- **Collapsed spaces.** Simania 229293 has the title `עולם חדש  מופלא`, with two spaces. The Wikidata bridge finds nothing for that string, but it finds `Brave New World` for `עולם חדש מופלא`. So the edition fell to the fuzzy step, which proposed 2535390, a Hebrew-titled duplicate with 0 readers. The current link is 374328 `Brave New World`, with 6121 readers.
- **Prefix-only match.** For Simania 957695 `המצפן הזהוב`, the Wikidata bridge gives `Northern Lights`. Hardcover's search for it does not return 355708 `The Golden Compass` (4049 readers). The retry with the author returns 1135414 `Northern Lights: Bolvangar` (2 readers), which matches only before the colon. NLI gives `Golden Compass`, which would find 355708, but the NLI step runs only when the Wikidata step found nothing.
- **Provider failures.** In two full dry runs, 19 and then 37 of 331 editions were skipped with `provider_failure`. Each of them succeeds when it is rechecked alone.

# Scope

1. **Collapsed spaces (S33).** In the title-normalization rules (`matchTitle`), every run of whitespace inside the title becomes one space, before any bridge or search uses it.
2. **Prefix-only matches are weak (S33).** In the resolver decision (Wikidata → NLI → fuzzy):
   - A match is *prefix-only* when the bridge title's similarity to the book's full title is below 0.9, but its similarity to the part before the first colon is at least 0.9.
   - When the Wikidata step's match is prefix-only, the NLI step also runs. If the NLI step finds a match that is not prefix-only, that match wins, with status `nli`. Otherwise the Wikidata match stays.
   - A non-prefix-only Wikidata match is unchanged: the NLI step does not run.
3. **Recheck retries provider failures (S33).** For `npm run recheck:links`:
   - After the main pass, every edition skipped with `provider_failure` is rechecked once more, one at a time, with a pause of at least 2 seconds before each one.
   - Only editions that fail again print `skipped: "provider_failure"`.
   - The summary line adds `retried` (the number rechecked again).

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
