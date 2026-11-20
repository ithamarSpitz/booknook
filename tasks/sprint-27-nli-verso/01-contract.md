---
id: S27-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**NLI title page verso (S27).**','**Hardcover budget (S27).**','Title page verso','x-ratelimit-daily-remaining','--min-hardcover','Sleepovers'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes S27. Measured on prod on 2026-11-20: 29 of the 64 unlinked Hebrew shelf editions are translations. For 17 of them, neither Wikidata nor the NLI 240/130/765 fields give an original title. But NLI often records the original in MARC 246 with subfield `i` `Title page verso:`. For example, Simania 1530 `סודות` by `ג'קלין ווילסון` has 041 `$a heb $h eng` and 246 `$i Title page verso: $a Secrets : $b Jacqueline Wilson`. Hebrew originals have the same kind of 246 (Simania 1729 `תנו לגדול בשקט` by `ליאת רוטנר`: `Leave them kids alone : Liat Rotner`), but their 041 has no `h`. So 041 `h` separates the two. In the probe, all 10 unbridged translations that had a verso title had `041 $h eng`, and none of the 24 Hebrew originals did.

Also measured on 2026-11-20: the shared Hardcover key is Free tier (60 requests a minute, 5000 a day, reset at 00:00 UTC). Operator runs used the whole daily quota, so every resolution stayed `pending` and the app lost English search for the rest of the day.

# Scope

1. A paragraph **NLI title page verso (S27).** in the resolution procedure, right after the NLI fallback bridge rule (rule 2). Its rules:
   - When parsing an NLI record, add more original-title candidates after the 240, 130 and 765 candidates. They are added only when the record's 041 field has a subfield `h` whose value is not `heb`.
   - A candidate is each 246 field whose subfield `i` starts with `Title page verso` and whose subfield `a` has a Latin letter and no Hebrew letter.
   - The candidate title is subfield `a` with trailing spaces, `:`, `/`, `;`, `,` and `.` removed.
   - Subfield `b` of the same 246 gives `verso author` when it has a Latin letter and no Hebrew letter. It is the text before the first `;`, with the same trailing characters removed.
   - The rest of the record rules are unchanged: the candidate must differ from the record's title, and the same Dice thresholds and ranking apply. It applies wherever the add-book NLI record rules are used, including the recommendation `nliHebrew` step.
   - Author hint order for the NLI Hardcover match: the catalog hint, then `verso author` of the chosen record, then the Wikidata author bridge, then the NLI creator.
   - Examples:
     - 1530: `041 $h eng`, `Secrets : Jacqueline Wilson`, gives the bridge `Secrets` with `verso author` `Jacqueline Wilson`;
     - 1529: `Sleepovers : Jacqueline Wilson ; illustrations, Nick Sharratt.` gives `Sleepovers` with `Jacqueline Wilson`;
     - 1729: no 041 `h`, so no candidate;
     - a record with `041 $h heb` gives no candidate.
2. A paragraph **Hardcover budget (S27).** next to the `refresh:all` and `verify:fallback` sections. Its rules:
   - Before any other work, `refresh:all` and `verify:fallback -- --population|--replay-linked` make one Hardcover GraphQL request `{ me { id } }` with the operator's `HARDCOVER_API_KEY`.
   - They read the `x-ratelimit-daily-remaining` response header (on any status, including 429), and print `{ "hardcover_daily_remaining": n }` (`null` if the key, the header or the request is missing).
   - When `n` is a number below `--min-hardcover <n>` (default `1500`), they print a one-line reason and exit `4` without opening the database. `--force-hardcover` skips only this stop.
   - `--compare` makes no request.
   - The key is never printed.

Change nothing else.
