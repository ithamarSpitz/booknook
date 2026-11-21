---
id: S37-T4
stage: 3
model_class: worker
timeout_minutes: 40
review: true
depends_on:
  - S37-T2
  - S37-T3
allowed_paths:
  - scripts/lib/rematch.ts
  - supabase/functions/_shared/simania.ts
  - tests/functions/rematch-lib.test.ts
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

Contract: "**Rematch cached works (S37).**" (decision part). This is a pure module with every provider injected. It finds the candidate Hebrew editions for one English-only work and confirms each candidate. It never writes, and the CLI comes in S37-T5.

# Scope

1. `supabase/functions/_shared/simania.ts`: `searchBooks(query, limit, offset = 0)` passes `offset` to `books_search`. Existing callers don't change.
2. New `scripts/lib/rematch.ts` exports:
   - `type RematchWork = { id: string; hardcover_id: number; original_title: string; original_authors: string[] | null }`.
   - `authorNamesFromLinks(pairs: { he: string; en: string }[]): Map<string, string[]>`
     - The key is `normalize(en)`. The value is the distinct trimmed `he` names with `nameSoundScore(he, [en]) >= 0.8`.
     - Keys with no kept name are absent. This drops translators and co-author mix-ups seen in prod links: `גדעון טיקוצקי` for Antoine de Saint-Exupéry, and `הולי ג'קסון` for Alice Feeney.
   - `titleMatches(englishTitle, original): boolean` is true when either value is `>= 0.72`:
     - `similarity(englishTitle, original)`;
     - `similarity(strip(englishTitle), strip(original))`, where `strip` removes `(...)` groups, everything from the first `:`, and a leading `The `, then trims.
   - `findCandidates(work, deps): Promise<{ candidates: { simania_id: number; via: "forward" | "reverse" }[]; failed: boolean }>`, where the injected `deps` are `hebrewHint(work)`, `matchHebrewBook(title, author)` (resolving to a Simania id or null), `hebrewNames(work)`, `searchBooks(query, limit, offset)`, `originals(title, hebrewAuthor)`, and `linkedSimaniaIds: Set<number>`.
     - **Forward:** if `await deps.hebrewHint(work)` gives a hint, `deps.matchHebrewBook(hint.title, hint.author ?? "")` gives the candidate `via: "forward"`, unless that id is in `linkedSimaniaIds`.
     - **Reverse,** only when forward gave no candidate:
       - For each name from `deps.hebrewNames(work)`, call `searchBooks(q, 50, offset)` for offsets 0, 50, … up to 250, stopping after a page with fewer than 50 results. `q` is the name when it is one word, otherwise its first and last words.
       - Keep books that have an id not in `linkedSimaniaIds`, a title with a Hebrew letter, and `similarity(name, book.author) >= 0.6`.
       - Go through at most 60 kept books, in result order and without duplicates. A book is a candidate `via: "reverse"` when some title from `deps.originals(book.title, name)` passes `titleMatches(work.original_title, original)`.
     - Any thrown error sets `failed: true`. The candidates found so far are kept.
   - `confirmCandidate(work, edition: EditionRow, deps: { resolveMatch(edition: EditionRow): Promise<ResolveMatchResult> }): Promise<{ accepted: boolean; status: "wikidata" | "nli" | "fuzzy" | null; book: HardcoverBook | null; failed: boolean }>`
     - `accepted` is true when the found book's `id` equals `work.hardcover_id`, or when `sameBook` (exported from `supabase/functions/link-edition/index.ts`) is true for `{ original_title: book.title, original_authors: authors(book) }` and the work.
     - `status` and `book` come from the found result. `failed` is the result's `failed` when nothing was found, otherwise false.

# Tests

New `tests/functions/rematch-lib.test.ts`, with stubs only. These are real 2026-11-21 cases:
1. `authorNamesFromLinks` on the pairs (`אליס פיני`, Alice Feeney), (`הולי ג'קסון`, Alice Feeney), (`גדעון טיקוצקי`, Antoine de Saint-Exupéry), and (`וולי למב`, Wally Lamb) keeps `אליס פיני` and `וולי למב` only. Any expectation about another spelling must come from the real `nameSoundScore` value.
2. `titleMatches("Insomnia", "Insomnia")` is true; `titleMatches("The Lathe of Heaven", "Lathe of Heaven")` is true; `titleMatches("Home", "Homegoing")` is false.
3. Forward: the hint `{ title: "רזה" }` and `matchHebrewBook` returning 3191 give `[{ simania_id: 3191, via: "forward" }]`, and `searchBooks` is never called.
4. Reverse: no hint, and the names are `["סטיבן קינג"]`. The search returns 50 books and then 3. `originals` maps `נדודי שינה` to `["Insomnia"]`, so the work Insomnia gets that book `via: "reverse"`. A linked id is skipped, and exactly 2 `searchBooks` calls are made, at offsets 0 and 50.
5. `originals` throws → `failed: true`.
6. `confirmCandidate`:
   - `resolveMatch` finds the same id → accepted, with the status kept.
   - It finds another id with the same title before the colon and the same author → accepted.
   - It finds a different book → not accepted. Case: Simania 108889 `ארץ אחרת- 4 כרכים` by `טד וויליאמס` resolves to a Tad Williams book, for the work Another Country by James Baldwin.
   - It finds nothing, with `failed: true` → `failed: true`.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
