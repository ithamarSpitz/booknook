---
id: S37-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Initials in name sound (S37).**','**Batched Wikidata lookups (S37).**','**Rematch cached works (S37).**'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes three general S37 rules, with no book-specific constants. Put them next to the S36 rules.

Measured on prod on 2026-11-21:
- There are 2,826 cached works, and 2,297 of them have no linked Hebrew edition. Most were matched before later fixes and never retried, because `refresh:all` only handles books in current use.
- I took 300 random English-only works and checked them independently, through the author's Hebrew books on Simania and the NLI and Wikidata original titles. That found Hebrew translations for 48 works. The current hint and match steps find 37 of them.
- `nameSoundScore("שרי טפר", ["Sheri S. Tepper"])` is 0.67, but it is 1.00 for `"Sheri Tepper"`. The middle initial blocks the match.
- One SPARQL request answered 120 English author names in 1.7 s. That is 66 agreeing with the per-name lookup, 4 more, 1 fewer, and 0 different. One SPARQL request mapped 20 Hebrew titles to the same original titles as the per-title lookup, or found ones that the rate-limited per-title lookups missed.

# Scope

1. **Initials in name sound (S37).**
   - `nameSoundScore` (browser `public/js/names.js` and server `supabase/functions/_shared/names.ts`) also scores each Latin name with its single-letter initials removed. Such a token is one Latin letter, optionally followed by `.`.
   - The result is the higher of the two scores. A name made only of initials is not changed.
   - Every pair in the existing name-sound tests keeps its expected side.
2. **Batched Wikidata lookups (S37).** Two server helpers in `supabase/functions/_shared/bridges.ts`, used by operator jobs. Each sends one SPARQL POST to `https://query.wikidata.org/sparql` per chunk of at most 100 inputs.
   - `wikidataHebrewAuthors(names)`: English name (an exact `rdfs:label` or `skos:altLabel` in `en`) → Hebrew `rdfs:label`s of items that are an instance of human (Q5).
   - `wikidataOriginals(hebrewTitles)`: Hebrew `rdfs:label` → English labels of that item, or of the work it is an edition of (P629). Only items whose type is one of the bridge's existing `WORK_TYPES` count.
   - A non-OK response or a response that isn't JSON throws `ProviderError`. It never returns an empty answer.
3. **Rematch cached works (S37).** Operator job `npm run rematch:cached`, a dry run unless `--apply`. It covers every cached work with no linked Hebrew edition.
   - **Candidates.**
     - **Forward:** the recommendation hint (`defaultHebrewHint`) followed by the browser's `matchHebrewBook`.
     - **Reverse,** only when forward gives nothing: the author's Hebrew names, then the author's Simania books, then their original titles.
       - The Hebrew names come from existing links: an edition's `author` paired with its work's first original author, kept when `nameSoundScore >= 0.8`. If there are none, they come from `wikidataHebrewAuthors`.
       - Original titles come from `wikidataOriginals` plus `nliOriginal`. A candidate needs an original title with `similarity >= 0.72` to the work's title, also comparing both titles with any `(...)`, anything after a `:`, and a leading `The` removed.
   - **Confirmation.** A candidate is accepted only when the existing `resolveMatch` on that Hebrew edition returns the same work: the same Hardcover id, or `sameBook` (S36).
     - A candidate already linked to another work is skipped.
     - A provider failure skips the work. It is never treated as "no match".
   - `--apply` links each accepted edition with the `resolveMatch` status. It creates the edition row from Simania details when it doesn't exist, and fetches Hardcover details first for search-document books (S35).

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
