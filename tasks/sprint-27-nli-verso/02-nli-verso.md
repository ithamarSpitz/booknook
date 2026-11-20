---
id: S27-T2
stage: 2
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on:
  - S27-T1
allowed_paths:
  - supabase/functions/_shared/bridges.ts
  - tests/functions/nli-original.test.ts
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

NLI parsing in `supabase/functions/_shared/bridges.ts` adds the title page verso candidates. Contract: "**NLI title page verso (S27).**".

# Scope

- In `parseNliRecords`:
  - read 041 subfield `h` values;
  - when any of them is not `heb`, append the 246 verso candidates to `originals`, after 240/130/765 and in source order;
  - keep each candidate's `verso author`.
- `nliOriginal` returns the bridge with an optional `versoAuthor` (the `verso author` of the chosen candidate, when it has one). Add it to the `Bridge` type as an optional field.
- `nliHebrew` uses the extended `originals` with no other change.
- Change nothing else.

# Tests

In `tests/functions/nli-original.test.ts`, using MARC XML fixtures in the file's existing style:

1. A record with 245 `סודות /`, 041 `$a heb $h eng` and 246 `$i Title page verso: $a Secrets : $b Jacqueline Wilson` gives `{ title: "Secrets", versoAuthor: "Jacqueline Wilson" }`, with source `NLI`.
2. 246 `$a Sleepovers : $b Jacqueline Wilson ; illustrations, Nick Sharratt.` gives `Sleepovers` and `Jacqueline Wilson`.
3. The same 246 without 041 `h` (a Hebrew original, `תנו לגדול בשקט`, `Leave them kids alone : Liat Rotner`) gives `null`.
4. 041 `$h heb` gives `null`.
5. A record with both 240 `Bad girls.` and a verso 246 uses the 240 value.
6. A 246 with `$i Parallel title:` is ignored.
7. `nliHebrew("Secrets", "Jacqueline Wilson")` finds the Hebrew record `סודות` from test 1's fixture.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
