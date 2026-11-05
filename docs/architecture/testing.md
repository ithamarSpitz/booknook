# Testing

## Layers

| Layer | Tool | Command | Network |
|---|---|---|---|
| Database | pgTAP via Supabase CLI | `npm run test:db` | local stack only |
| Edge Functions, types | Deno | `npm run check:functions` | none |
| Edge Functions, unit | Deno test with stubbed `fetch` and a fake DB client | `npm run test:functions` | none |
| Web, pure modules | `node --test` | `npm run test:web` | none |
| Integration gate | Node script against local stack and live APIs | `npm run verify:integration` | live |
| Resolution gate | Deno script: real resolver, in-memory DB, live Wikidata/NLI/Hardcover, real problem books | `npm run verify:resolution` | live |
| Localization gate | Deno script: the real recommendation localization chain (title hint, then author path) on real books, live Wikidata/NLI/Hardcover/Simania | `npm run verify:localization` | live |
| Repair gate | Deno script: real link repair proposals and catalog audit against a read-only production session | `npm run verify:repair` | live |

## Shared local Supabase stack

There is one local Supabase stack (`project_id = "booknook"`, API on 54321, DB on 54322), started once by the operator with `npm run supabase:start`. Harness worktrees all talk to it.

- Only tasks whose brief says so may run `supabase db reset` or `supabase test db`. The roadmap never puts two such tasks in the same stage.
- No task starts, stops or reconfigures the stack.
- Automated tests never call Simania, Hardcover, Wikidata or NLI; only the live gates above do. Stub `fetch` with recorded fixtures under `tests/functions/fixtures/`.
- `npm run verify:repair` is read-only against production: it validates known repair cases and runs the catalog audit without applying links.

## Fixtures

Use real recorded shapes. The prototype (`prototype/test-page.html` and the current `_shared` code) shows the response formats.
