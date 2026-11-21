---
id: S41-T1
stage: 1
model_class: worker
timeout_minutes: 15
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const k of ['**Author name comparison (S41).**','**Author by sound (S41).**','**Dictionary contradictions (S41).**'])if(!t.includes(k))throw new Error(k)"
---

# Goal

`docs/contract.md` gets three general rules right after "**Rematch author agreement (S40).**". No book-specific or author-specific constants.

1. **Author name comparison (S41).** `sameAuthor(hebrewName, englishName)` in `supabase/functions/_shared/author-sound.ts` is true when the two names are the same person by sound:
   - the surname must match, and so must the first name;
   - if both names spell out middle names, every English middle name must be there;
   - English initials before the surname ("A.D. Miller") need initials on the Hebrew side.

   The exact scoring is defined in S41-T2. It is a pure function with no network calls. "**Rematch author agreement (S40).**" also passes when `sameAuthor` is true for some edition-author variant and some English author.
2. **Author by sound (S41).** When an English author has no Hebrew name in the authors table and Wikidata has none, the operator scripts (`rematch:cached`) may look it up on Simania by sound:
   - Generate likely Hebrew spellings of the name, search Simania with them, and keep only book authors for which `sameAuthor` is true.
   - The spelling used on the most books wins.
   - A found name is stored in `author_names` with source `sound`, and `authors.sound_checked_at` records the check (rechecked after 30 days).
   - Edge Functions never run this lookup, because of its cost (up to 26 Simania searches). They read the stored names like any other.
3. **Dictionary contradictions (S41).** A dictionary pick (`pickByDictionary`) needs all of the following, and the best score must still be unique:
   - English side ≥ 0.67: the share of English content words covered by the Hebrew title's glosses (today's score);
   - Hebrew side ≥ 0.67: the share of Hebrew content words whose glosses cover some English content word;
   - **no contradicted Hebrew word.** A Hebrew word is contradicted when it has glosses but none of them covers an English content word. A word with no glosses is unknown, not contradicted.

Measured on 2026-11-21:
- **Name comparison and sound lookup:** 99 authors with known Hebrew spellings, 80 found with 0 wrong people. Without the first-name rule, Veronica Roth matched בריאן רוט and Liane Moriarty matched ג׳קלין מוריארטי.
- **Dictionary:** on 22 real pairs, today's rule accepted all 9 wrong ones (מאדים הירוק for *Red Mars*, Princess Diaries sequels for *The Princess Diaries*). The new rule accepts 5 of the 13 right ones and 0 wrong.

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
