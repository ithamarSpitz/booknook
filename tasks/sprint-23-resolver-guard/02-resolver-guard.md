---
id: S23-T2
stage: 2
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S23-T1
allowed_paths:
  - supabase/functions/_shared/fallback-match.ts
  - supabase/functions/_shared/catalog.ts
  - tests/functions/add-book-catalog.test.ts
  - tests/functions/fallback-parity.test.ts
context:
  - contract
  - architecture.testing
  - architecture.functions
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

The server never attaches a Hebrew edition to an English work whose author is clearly someone else. Example: 972426 דברי by לורי האלס אנדרסון was attached to Dream of the Red Chamber (Cao Xueqin).

# Scope

Contract: "Resolver author guard (S23)".

1. `supabase/functions/_shared/fallback-match.ts`: export `authorGuardRejects(simaniaAuthor, englishAuthors, hebrewAuthor)`.
   - Port it from `public/js/hebrew-fallback.js`, the same rules including any S22 rules there, using `_shared/names.ts` `nameSoundScore` and the server `similarity`.
   - If the browser file does not have the S22 rules yet, still add them: never reject when there is no non-empty English author, or when every English author has a Hebrew letter.
2. `supabase/functions/_shared/catalog.ts`, `ensureResolved`:
   - after each path's match (wikidata, nli, fuzzy), take the match's contributor names, the same names `upsertWork` stores as `original_authors`;
   - if the guard rejects, drop that match and go on to the next path, as if it found nothing;
   - a rejection does not add to `failures`.

   Nothing else changes.

# Tests

1. `add-book-catalog.test.ts`, with provider stubs:
   - **Wrong match dropped:** edition `{ title: "דברי", author: "לורי האלס אנדרסון" }`; the wikidata path returns a book by "Cao Xueqin"; the nli path returns a book by "Laurie Halse Anderson". The edition ends linked to the second book, with status `nli`.
   - **Every path wrong:** the edition becomes `not_found`, not `pending`.
   - **Right match kept:** ג'ו היל with a "Joe Hill" wikidata match still links, with status `wikidata`.
   - **No authors:** a match with no contributors is not rejected.
2. `fallback-parity.test.ts`: the guard cases from `tests/web/hebrew-fallback.test.mjs`, with the same expected results.
3. Existing tests pass.

# Acceptance criteria

1. The behavior above; `check:functions` and `test:functions` pass.
