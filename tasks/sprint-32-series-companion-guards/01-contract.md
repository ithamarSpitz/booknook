---
id: S32-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Series entities (S32).**','**No box set for a single book (S32).**','**Companion books (S32).**','Q1667921'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes three S32 guards. They are general: there are no book-specific constants.

Measured on prod on 2026-11-21, by the `recheck:links` dry run (not applied):
- **Series entities.** The Wikidata bridge for `משחקי הכס` now returns Q45875 `A Song of Ice and Fire`, and for `המצפן הזהוב` it returns Q129240 `His Dark Materials`. Both have P31 `Q1667921` (novel series), and Q129240 also has `Q13593966` (literary trilogy). They pass because they have a P50 author.
  - The match then proposed `The World of Ice and Fire` for `משחקי הכס`, and the `His Dark Materials` box for `המצפן הזהוב`.
  - The current links (`A Game of Thrones`, `Northern Lights`) are right.
- **Box set for a single book.** For `המעון של מיס פרגרין לילדים משונים`, the match proposed 609447 `Miss Peregrine's Peculiar Children Boxed Set: 3 Novels`.
- **Companion books.** The other candidate was 609448 `The Art of Miss Peregrine's Home for Peculiar Children`.

# Scope

1. In the Wikidata bridge rules (step 1), add:
   - **Series entities (S32).** Also reject an entity whose P31 includes literary or novel series (`Q1667921`), literary trilogy (`Q13593966`), book series (`Q277759`) or series of creative works (`Q7725310`), even when it has a P50 author.
   - If the existing reject list names `Q277759` as something else, correct the label to "book series".
2. In step 3 (**Hardcover match**), add:
   - **No box set for a single book (S32).** Unless the match is a box-set match (`boxTitle`), drop books whose title contains `Trilogy`, `Collection`, `Box Set`, `Boxed Set` or `Omnibus` (case-insensitive, whole words), unless the query title itself contains that word.
   - **Companion books (S32).** Drop books whose title contains any of these, unless the query title itself contains it (case-insensitive, whole words): `The Art of`, `The World of`, `Companion`, `Summary`, `Study Guide`, `Reader's Guide`, `Analysis`, `Coloring Book`, `Workbook`, `Untold History`.
   - Both apply before ranking, in every pass, and in `verify:fallback`.

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
