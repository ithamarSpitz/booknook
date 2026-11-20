---
id: S26-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Edition labels (S26).**','**`npm run requeue:not-found`**','Holes','pending'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes S26. Measured on prod on 2026-11-20: 64 Hebrew shelf editions have no English work, and about 29 of them are translations. For example, Simania 32249 `בורות - מהדורת 2003` (Holes) stays `not_found`: Wikidata and NLI find nothing for the full title, but `בורות` alone resolves to Holes by Louis Sachar. The same is true for `כמה טוב להיות פרח קיר - עטיפת הסרט` (Perks of Being a Wallflower), `טירת הזכוכית - מהדורה מחודשת` (The Glass Castle) and `אלה המכושפת - מהדורה מחודשת` (Ella Enchanted). A `not_found` edition is retried only when it is 14 days old and its details are requested.

# Scope

1. A paragraph **Edition labels (S26).** next to the description of `matchTitle` (the Simania display title with trailing edition labels removed). Add these rules:
   - `matchTitle` also removes a trailing ` - ` or ` – ` segment (a hyphen or en dash with a space on each side) when that segment contains `מהדורה`, `מהדורת`, `עטיפת`, `כריכה`, `הדפסה` or `כרכים`.
   - It repeats together with the existing `[...]` and `(...)` rules, until nothing changes.
   - It never returns an empty string.
   - Examples:
     - `התלקחות - משחקי הרעב 2 - כריכה קשה` becomes `התלקחות - משחקי הרעב 2`;
     - `אידיוט - כרכים א'-ב' [מהדורת 1993]` becomes `אידיוט`;
     - `יומני רובורצח - כרך 1` is unchanged.
2. In the `npm run refresh:all` section, step 4 also covers the reader's positive editions whose `resolve_status` is `pending`. `book-details` already runs the resolution for a pending edition.
3. A paragraph **`npm run requeue:not-found`** (`scripts/requeue-not-found.ts`, S26). Its rules:
   - It lists every positive-ID edition with `resolve_status` `not_found` and `work_id` null that is on any reader's shelf, recommendation or genre row.
   - The default is a dry run with a read-only connection. It prints one JSON line per edition (`simania_id`, `title`, `author`), then `{ "total": n }`.
   - `--apply` sets those editions to `resolve_status` `pending` and `resolved_at` null, and prints the same lines and `{ "requeued": n }`. It changes nothing else.
   - The operator runs it after a resolver change is deployed, then runs `refresh:all -- --apply`.
   - `--simania <id>` limits it to one edition.

Change nothing else.
