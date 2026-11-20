---
id: S24-T1
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['**Speed (S24).**','--concurrency','--skip-cache','one Simania throttle'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes a faster `npm run refresh:all`. Measured 2026-11-20: one reader with 31 English-only genre rows took about 6 minutes and changed nothing, because every book is handled one at a time and every English-only book is checked again on every run.

# Scope

Only the `npm run refresh:all` section of `docs/contract.md`.

1. Change "concurrency 1" in step 2 to "concurrency `--concurrency N`".
2. Change step 3 so the genre rows also run `--concurrency N` at a time, each still `genre-hint` then `localizeRecommendations` on that book.
3. Keep "Readers are processed sequentially."
4. Add a bullet **Speed (S24).** with these rules:
   - **Concurrency.** `--concurrency N` is an integer from 1 to 8; the default is 4. Any other value exits `2` before any network call. Results never depend on N. The per-reader totals and the set of `link-edition` calls are the same as with N = 1, except where two books of one reader link the same Simania edition (then which one gets the `409` can depend on timing).
   - **Simania.** The run has one Simania throttle, shared by every reader and every concurrent book: at least 1,000 ms between the starts of any two Simania requests. This replaces the per-reader throttle. Step 4 (editions without details) goes through the same throttle.
   - **Skip cache.** `--skip-cache <file>` is optional. Without it nothing is cached and the run behaves as before.
     - The file is JSON: `{ "code": "<hash>", "entries": { "<work_id>": "<ISO time checked>" } }`.
     - `code` is the SHA-256 hex digest of the contents of every `.js` file under `public/js` and every `.ts` file under `supabase/functions`, sorted by path, each path followed by its contents.
     - Before step 2, an English-only card or genre row is skipped if its `work_id` is in `entries`, the file's `code` equals the current hash, and the time is less than 7 days old. A skipped genre row makes no `genre-hint` call.
     - A book is added with the current time only when it was checked, made no failure, and was not linked. Linked books and failed books are never added.
     - If `code` differs from the current hash, all entries are dropped.
     - A missing file is an empty cache. A file that is not valid JSON exits `2` before any network call.
     - The file is written once at the end of the run, also after a failure that stops the run.
     - Each reader summary adds `skipped`: the number of skipped cards and genre rows.
   - **Dry run.** These flags do not change the dry run.
