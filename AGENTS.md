# Agent Operating Contract

This repository is executed by a task-oriented coding harness (see `README-HARNESS.md`). This file is a router plus global rules.

## Source-of-truth order

1. `docs/assignment.md`: product decisions.
2. `ARCHITECTURE.md` and `docs/architecture/**`: technical design.
3. `docs/contract.md` and `supabase/functions/_shared/types.ts`: interface between lanes (after sprint S0).
4. The current task brief under `tasks/`.
5. Existing implementation.

Never silently resolve a conflict between levels 1 to 4. Stop and report it.

## Context policy

1. Read the current task brief first.
2. Load only the context aliases the task names.
3. Inspect only files relevant to the task.
4. `design/library.html` is large (embedded images). Search it for the parts you need; do not read it whole.

## Global rules

- Stack: static HTML/CSS/ES modules in `public/`, Supabase Postgres + Auth, Deno Edge Functions. No framework, no bundler, no new runtime dependencies unless the task allows it.
- Hebrew UI, RTL. Display Hebrew text exactly as the source returns it.
- Provider secrets stay server-side. Never put `HARDCOVER_API_KEY` or a service-role key in `public/`.
- Automated tests never call Simania, Hardcover, Wikidata or NLI. Stub `fetch`.
- There is one shared local Supabase stack. Run `supabase db reset` or `supabase test db` only if your task brief says so. Never run `supabase start`, `stop` or edit `supabase/config.toml` unless your brief says so.
- Work only on the current task. Do not modify files outside `allowed_paths`. If required scope is missing, stop and report it.
- Do not edit `docs/assignment.md`, `ARCHITECTURE.md`, `docs/architecture/**`, `design/**` or `prototype/**`.
- Do not weaken or delete tests or database constraints to make verification pass.
- Keep changes small, reviewable and deterministic.
- Do not commit; the harness owns commits and merges.

## Commands

```text
npm run check:functions    deno type check of all functions
npm run test:functions     deno unit tests (tests/functions)
npm run test:web           node --test (tests/web)
npm run test:db            supabase db reset + supabase test db   (only when the brief allows)
npm run check:contract     contract presence check
```

## Definition of done

The harness accepts a task only when task and global verification pass, changed files stay within scope, review passes when configured, and the stage merge passes.

When an implementation attempt ends, report:

- `STATUS`: implementation finished / blocked
- `CHANGED_FILES`
- `TEST_RESULTS`
- `OPEN_ISSUES`
