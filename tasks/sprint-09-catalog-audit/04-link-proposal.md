---
id: S9-T4
stage: 2
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S9-T2
  - S9-T3
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

For one unlinked Hebrew edition, propose the Hardcover work it translates, deterministically and only with strong evidence.

# Scope

Contract: "Operator scripts: catalog audit and link repair", **Link proposal**. New `scripts/lib/link-proposal.ts` exporting:

`proposeLink(edition: { simania_id: number; title: string; author: string | null }, deps?: Partial<ProposalDeps>): Promise<LinkProposal>` where

- `ProposalDeps` is `{ fetchPage(id): Promise<string>; wikidataEnglishAuthor(name): Promise<string | null>; searchIds(title): Promise<number[]>; books(ids): Promise<HardcoverBook[]> }`, defaulting to `fetchSimaniaPage` (`scripts/lib/simania-page.ts`), `wikidataEnglishAuthor` (`supabase/functions/_shared/bridges.ts`), and `searchHardcoverBooks` / `hardcoverBooks` (`supabase/functions/_shared/hardcover.ts`).
- `LinkProposal` is `{ simania_id, original_title: string | null, english_author: string | null, book: HardcoverBook | null, reason: "ok" | "no_original_title" | "no_author_match" | "ambiguous" | "provider_error" }`.

Rules exactly as in the contract:
- The original title comes from `pageOriginalTitle`.
- Candidates are the searched books (first 8 ids) whose title `similarity` to the original title is at least 0.9. Use the same `similarity` the resolver uses for titles in `_shared/hardcover.ts`.
- With an English author: take the best-scoring candidate whose authors match it (`similarity > 0.45`). Break ties by higher `users_read_count`, then lower id.
- Without one: accept only if exactly one candidate has `nameSoundScore(edition.author, authors(book)) >= 0.5`. No such candidate gives `no_author_match`; several give `ambiguous`.
- Any dependency that throws gives `provider_error`. No database access.

# Tests (new `tests/functions/link-proposal.test.ts`, fakes only, no network)

Model the fakes on the real data measured on 2026-11-05:
1. Under the Dome (905132, `סטיבן קינג`): page title `Under the Dome`, English author `Stephen King`; candidates are 384966 by Stephen King plus a same-title book by another author. Expect 384966, `ok`.
2. Just for the Summer (1014927, `אבי חימנז`): no English author; 8 candidates titled "Just for the Summer" by Karin N. Mango, Laura Van Wormer, Abby Jimenez (884117), Judy Astley, Melody Carlson, Jenna Rutland, Sue Moorcroft, and one with no author. Expect 884117, `ok`.
3. Hebrew original (no page title): `no_original_title`, `book` null.
4. Two candidates whose authors both sound-match: `ambiguous`.
5. No candidate title reaches 0.9: `no_author_match`, `book` null.
6. `fetchPage` throws: `provider_error`.

# Acceptance criteria

1. The behavior above; all tests pass.
