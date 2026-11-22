---
id: S45-T1
stage: 1
model_class: worker
timeout_minutes: 60
review: true
depends_on: []
allowed_paths:
  - scripts/study/hebrew-dictionary-study.ts
  - docs/reports/2026-11-22-hebrew-dictionary-study.md
context:
  - architecture.matching
environment: null
verification:
  - >-
    node -e "const t=require('fs').readFileSync('docs/reports/2026-11-22-hebrew-dictionary-study.md','utf8');for(const k of ['found:','right:','wrong:','editions:'])if(!t.includes(k))throw new Error(k)"
---

# Goal

**Measure before building. Spend as few tokens as possible:** read only what you need, and run scripts rather than reading code.

`rematch:cached --hebrew` only calls `resolveMatch`. The S41 dictionary (`scripts/lib/dictionary.ts`, `pickByDictionary`) and the sound lookup (`supabase/functions/_shared/author-sound.ts`) only run in the English direction, so they never ran for the 136 cached Hebrew editions that have no work.

Write `scripts/study/hebrew-dictionary-study.ts` (read-only) and run it once against production:

```
set BOOKNOOK_ENV_FILE=C:/Users/itas1/book-discovery-plan/.env.local
C:/Users/itas1/torimitor/node_modules/.bin/deno run --allow-net --allow-env --allow-read --allow-write --allow-sys scripts/study/hebrew-dictionary-study.ts
```

1. Load the editions with `simania_id > 0` and `work_id` null, using `openProdDb({ readOnly: true })` from `scripts/lib/prod-db.ts`.
2. For each edition:
   - translate the Hebrew title to English with the existing dictionary helpers;
   - get the English author from the author store or Wikidata;
   - search Hardcover through the existing helpers;
   - apply the S40/S41 author agreement.
3. When a book is found, check it independently: `nliOriginal(hebrew title, hebrew author)` from `supabase/functions/_shared/bridges.ts`, compared with the found title using `similarity` from `_shared/utils.ts` (≥ 0.6, after stripping parenthesized parts, anything after a colon, and a leading "The").
   - It counts as `right` if they match.
   - It counts as `wrong` if NLI gives a different title.
   - It counts as `unknown` if NLI gives nothing.

Limits:
- **Hardcover:** use at most 300 calls. The daily quota is low until 02:00, and `scripts/recheck-links.ts --simania 999999999` prints `hardcover_daily_remaining`. Stop if it falls below 800.
- **Wikimedia:** one request at a time, at least 300 ms apart, retry on 429.
- **No writes:** never write to the database.
- **No Hardcover website:** make no requests to it.
- **Secrets:** never print or write secrets, and never cat the env file.

Write `docs/reports/2026-11-22-hebrew-dictionary-study.md` with these lines: `editions: N`, `found: N`, `right: N`, `wrong: N`, `unknown: N`. Then add a table of every found pair: Hebrew title, English title found, NLI original, verdict.

# Acceptance criteria

1. The report exists with real numbers from the run.
2. The verification command passes.
