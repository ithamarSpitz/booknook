---
id: S21-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Author guard (browser, S21).**','authorGuardRejects','npm run audit:authors','**Name sound fixes (S21).**','Blue Exorcist','--any-status'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes S21. No Hebrew edition is linked to an English book when the Hebrew author is clearly a different person. The name-sound score works for short names, and the operator has an audit of existing links by author.

# Protected-path permission (operator decision, 2026-11-19)

`docs/contract.md` is protected. Permitted: edits A-D below, word for word. Not permitted: any other change, or any other file. The reviewer must fail the task otherwise.

# Edits

## A. Name sound fixes — insert right after the "**Shared helpers (pure, deterministic).**" list (after its last bullet)

**Name sound fixes (S21).** `nameSoundScore` (the same algorithm in `public/js/names.js` and `supabase/functions/_shared/names.ts`) must score these pairs of the same person at least 0.6: ג'ו היל / Joe Hill; ג'וג'ו מויס / Jojo Moyes; רוברט מ. פירסיג / Robert M. Pirsig; רואלד דאל / Roald Dahl; אלדוס האקסלי / Aldous Huxley; פאולו קואלו / Paulo Coelho; אן פאצ'ט / Ann Patchett; צ'אק פלאניוק / Chuck Palahniuk; ג'ורג' אורוול / George Orwell; הרוקי מורקמי / Haruki Murakami; אליסון נואל / Alyson Noël; ניקולה יון / Nicola Yoon. It must score these pairs of different people at most 0.3: וויליאם פיטר בלאטי / Kazue Kato; מילן קונדרה / Louis Sachar; ד'ר ד.אשבל / David Mitchell; ליאת רוטנר / Fanny Blake; אריקה לאונרד ג'יימס / Jasper Fforde; אשכר ארבליך-בריפמן / Boualem Sansal; ג'קלין ווילסטון / Pedro Mañas. All the pairs already in the name-sound tests keep their expected side. Measured 2026-11-19: ג'ו היל / Joe Hill scored 0.00, the same as וויליאם פיטר בלאטי / Kazue Kato.

## B. Author guard — insert right before "**Browser decision (`localizeFallback` in `public/js/recs.js`).**"

**Author guard (browser, S21).** Before any `link-edition` call from `localizeRecommendations`, from the title path, the author path or the fallback, the browser checks `authorGuardRejects(simaniaAuthor, englishAuthors, hebrewAuthor)` from `public/js/hebrew-fallback.js`:
- `englishAuthors` is the card's English author split on commas;
- `hebrewAuthor` is the card's `hebrew_author` or empty.

It rejects, and the card stays English-only with no link and no error, exactly when all of these hold:
- `simaniaAuthor` contains a Hebrew letter;
- `nameSoundScore(simaniaAuthor, englishAuthors) < 0.3`;
- not (`hebrewAuthor` is non-empty and `similarity(hebrewAuthor, simaniaAuthor) >= 0.5`).

An empty or Latin-script Simania author is never rejected. Measured 2026-11-19: Blue Exorcist (Kazue Kato) was linked by the title path to 2970 מגרש השדים by וויליאם פיטר בלאטי (The Exorcist).

## C. Operator tools — append to the "**`npm run refresh:all`**" section

- **Failure details (S21).** Every failed book is printed as one JSON line `{ "failed": { "title", "step", "function", "status", "message" } }`: `step` is recommendations, localize, genre-hint or details; `status` is the HTTP status or null; `message` is cut to 200 characters with any token-like string (`eyJ…`) replaced by `[redacted]`. Per-reader totals are as before.

Add a new paragraph after the "`npm run unlink:fallback`" paragraph:

**`npm run audit:authors`** (`scripts/audit-authors.ts`, read-only, S21) lists every linked positive-ID edition that is on any reader's shelf, recommendation or genre row and that `authorGuardRejects(edition.author, work.original_authors, "")` would reject. One JSON line per edition: `simania_id`, Hebrew title and author, `resolve_status`, work `hardcover_id`, English title and authors, and the best `nameSoundScore`. Then the totals. It writes nothing. The operator reviews this list. Repairs need the operator's OK, one by one: `npm run unlink:fallback -- --apply --simania <id> --any-status` unlinks one edition whatever its `resolve_status` (S21; without `--any-status`, `--simania` still accepts only `nli_author`).

## D. Known cases

In the "Must not link:" paragraph, add before "The two wrong links were": "Blue Exorcist (Kazue Kato) to 2970 מגרש השדים (The Exorcist; S21)."

# Acceptance criteria

1. The diff is exactly edits A-D; `npm run check:contract` and the verification command pass.
