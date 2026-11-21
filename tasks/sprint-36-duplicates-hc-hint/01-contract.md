---
id: S36-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Same-book duplicate works (S36).**','**Hardcover Hebrew edition hint (S36).**'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes two general S36 rules. They have no book-specific constants.

Measured on prod on 2026-11-21:
- **Duplicate works.** Hardcover has duplicate book entries. A reader's recommendation used work 62743 `The Strange Case of Dr. Jekyll and Mr. Hyde` (Robert Louis Stevenson, 0 readers). Its Hebrew edition 32314 is linked to work 2332122, which has the same title and author (1822 readers). So `link-edition` returned 409 "Edition belongs to another work", and the card stayed English-only. `How to Change Your Mind` failed the same way.
- **Hardcover Hebrew editions.** For 68 English-only used works, one `editions(where: {book_id in …, language.code2 = "he"})` request found Hebrew editions for 2: 325603 `Thinner` → `רזה`, and 381739 `Insomnia` → `נדודי שינה`. Wikidata and NLI give no Hebrew title for either. Simania has both, by the same author.

# Scope

1. **Same-book duplicate works (S36).** In `link-edition`, when the edition already belongs to another work:
   - The two works are *the same book* when their titles are equal after `normalize` and dropping everything from the first colon, and their first `original_authors` have `similarity` of at least 0.85.
   - For the same book, the request succeeds as if linked. The edition keeps its current work, and is never reassigned. The caller's recommendation rows for the requested work get this `simania_id`, and the shelf checks run as today. They also count the other work's editions as siblings, so a book already shelved still returns "Already on your shelves".
   - Different books still return 409.
2. **Hardcover Hebrew edition hint (S36).**
   - When the Wikidata and NLI hints are both empty, the recommendation hint uses a Hebrew-language Hardcover edition of the book: `editions` where `book_id` equals the book and `language.code2` is `he`, with the most `users_count` (ties: lowest edition id). The hint is `{ source: "hardcover", title, author: null }`.
   - It is one request per book that needs it, and a failure means no hint.
   - The browser treats `hardcover` hints like the others. A link made from one gets `resolve_status` `hardcover`, and `link-edition` accepts source `hardcover`.

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
