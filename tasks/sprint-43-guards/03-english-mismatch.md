---
id: S43-T3
stage: 3
model_class: worker
timeout_minutes: 40
review: true
depends_on:
  - S43-T2
allowed_paths:
  - scripts/rematch-cached.ts
  - scripts/lib/nli-english-mismatch.ts
  - tests/functions/nli-english-mismatch.test.ts
  - tests/functions/rematch-cached.test.ts
  - tests/functions/rematch-from-file.test.ts
  - tests/functions/rematch-hebrew.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Implement **English original mismatch (S43)** from `docs/contract.md`.

1. Write a pure function `nliEnglishMismatch(workTitle: string, nliTitle: string): boolean` in `scripts/lib/nli-english-mismatch.ts`. It returns true only when all three contract conditions hold. Use `similarity` from `supabase/functions/_shared/utils.ts`. The title strip used in our checks is:
   ```ts
   const strip = (t: string) => t.replace(/\(.*?\)|:.*$/g, "").replace(/^the\s+/i, "").trim();
   const s = Math.max(similarity(a, b), similarity(strip(a), strip(b)));
   ```
2. In `scripts/rematch-cached.ts`, add the step to the dry-run path, `--hebrew` and `--from … --apply`, after a proposal is formed and before it is printed or linked:
   - Call `nliOriginal(hebrewTitle, hebrewAuthor)` from `supabase/functions/_shared/bridges.ts`. Use the injectable deps object the script already has, so tests can fake it.
   - If the function returns true, skip with `nli_english_mismatch`. If NLI returns null or throws, keep the proposal.

# Acceptance criteria

1. `tests/functions/nli-english-mismatch.test.ts` checks these real pairs from 2026-11-22.
   - **True (wrong links):**
     - "Dune: The Graphic Novel, Book 1" / "Battle of Corrin"
     - "28 Summers" / "Summer of '69"
   - **False (correct links):**
     - "The Last Olympian" / "Percy Jackson and the Last Olympian"
     - "Moon Sister" / "Moon sisters"
     - "The Name of the Rose" / "Nome della rosa"
     - "The Package" / "Das Paket"
     - "Us Against You" / "Vi Mot Er"
     - "The Mysterious Affair at Styles" / "Murder"
     - "Daughter of Fortune" / "Roxana"
     - "On Love and Death" / "Über Liebe und Tod"
     - "Heaven" / "Then came heaven" (a known miss: the rule is not meant to catch it)
2. A rematch test with a fake `nliOriginal` that returns `{ title: "Battle of Corrin" }` gets `nli_english_mismatch`, and the same test with it returning `null` keeps the proposal. Do this once for the dry run and once for `--from --apply`.
3. Both verification commands pass.
