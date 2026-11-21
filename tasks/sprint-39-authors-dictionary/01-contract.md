---
id: S39-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Authors table (S39).**','**Dictionary last resort (S39).**'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes two general S39 rules, next to the S37/S38 rematch rules. They have no book-specific constants.

Measured on prod on 2026-11-21:
- `hebrewAuthorFor` takes the first linked edition's `author` for an English author, without checking it. In 3 of 333 linked English authors, that is another person: a translator (`גדעון טיקוצקי` for Antoine de Saint-Exupéry), or a co-author (`הולי ג'קסון` for Alice Feeney, `טרי פראצ'ט` for Neil Gaiman).
- A Wikidata error becomes a cached "no Hebrew name". Wikidata rate-limits per client (HTTP 429), so books were missed for that reason alone.
- A Hebrew-English dictionary (Wiktionary) was tested on 10 English-only works with known Hebrew editions that no bridge finds. It ranked each work's title against that author's unlinked Hebrew books: 5 were linked correctly (`עשב` Grass, `רזה` Thinner, `נערי ניקל` The Nickel Boys, `נערת הקפיץ` The Windup Girl, `האזור המת` The Dead Zone), 0 wrong, and 5 got no link.

# Scope

1. **Authors table (S39).**
   - **Storage.** `authors` holds one row per person. `author_names` holds each spelling: `lang` `en` or `he`, `name`, a `name_key` that is unique per `lang`, and `source` `link` or `wikidata`. Both tables are server-only (RLS on, no policies).
   - **Linked pairs.** A linked edition gives the pair (edition `author`, the work's first original author). The pair is stored only when `nameSoundScore(he, [en]) >= 0.8`. Names that meet an existing author join it, and two authors that one pair connects are merged.
   - **Lookups.** English→Hebrew (recommendation hints) and Hebrew→English (the resolve author hint) read the table first, and call Wikidata only for a name the table doesn't have.
     - A Wikidata answer is stored with `source` `wikidata`, and so is a successful "no name", as `wikidata_checked_at` on the author. That answer is retried after 30 days.
     - A Wikidata failure is never stored.
   - **Writing to the table.** A successful `link-edition` records its pair, and so does the operator `applyRepair`. `npm run authors:seed` fills the table from the existing links.
   - `rematch:cached` takes its Hebrew names from the table.
2. **Dictionary last resort (S39).** This applies only in `rematch:cached`, and only for a work where every other step gave no proposal and no provider failed.
   - **Scoring.** The candidates are the author's unlinked Hebrew books that the reverse step listed. Each candidate title is scored by Wiktionary glosses of its Hebrew words (`en.wiktionary.org/api/rest_v1/page/definition/<word>`, Hebrew sections only), each word also tried without a leading `ה ו ב ל מ ש כ` and without a plural suffix. The score is the share of the English title's content words that appear in the glosses.
   - **Accepting.** A book is proposed only when its score is `>= 0.5` and strictly higher than every other candidate's. It gets `via` `dictionary` and the new `resolve_status` `dictionary`, linked to the work itself.
   - A Wiktionary failure counts as a provider failure.

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
