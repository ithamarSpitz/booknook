# BookNook

Private Hebrew book library with discovery recommendations, for a small group of invited users. The web app is static HTML and ES modules; catalog and recommendation logic run in Supabase Edge Functions against a shared Postgres cache.

Product decisions live in `docs/assignment.md`. Technical design is in `ARCHITECTURE.md` and `docs/architecture/`.

## Data sources

| Source | Role |
|--------|------|
| **Simania** (official MCP, no auth) | Hebrew catalog: search, details, covers, community rating. Shelves hold Simania books only. |
| **Hardcover** (GraphQL, server secret) | Canonical work identity, similarity lists, genres and moods for recommendations. |
| **Wikidata**, **NLI** (fallback) | Bridge Hebrew titles and original titles in both directions. |

Provider secrets (for example `HARDCOVER_API_KEY`) stay in a local env file and never reach the browser.

## Architecture (summary)

- **Web app** (`public/`): talks to Supabase Auth and Postgres via `supabase-js`; no direct calls to Simania, Hardcover, Wikidata or NLI.
- **Edge Functions** (`supabase/functions/`): `add-book`, `book-details`, `recommendations`, `link-edition`, `invite-user`, plus shared code in `_shared/`. Simania is called from the browser (`public/js/simania.js`) because its Cloudflare blocks Supabase server IPs.
- **Database** (`supabase/migrations/`): shared catalog cache and per-user library tables with RLS.

## Repository layout

```text
public/                    web app (static files)
design/library.html        approved visual design (reference)
prototype/test-page.html   earlier test page (reference)
supabase/migrations/       SQL migrations
supabase/tests/            pgTAP database tests
supabase/functions/<name>/ one folder per Edge Function
supabase/functions/_shared/ shared Deno code; types.ts is the contract
tests/functions/           Deno unit tests (mocked fetch)
tests/web/                 node --test for pure web modules
scripts/                   verification and local serve helpers
docs/contract.md           interface contract between lanes
tasks/                     harness task briefs
harness.yaml               settings for the agent harness (installed separately)
```

## Local setup

Requirements: [Docker Desktop](https://www.docker.com/products/docker-desktop/) and Node.js (LTS).

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Start the local Supabase stack once (API on port 54321, Studio on 54323). All harness worktrees share this stack:

   ```bash
   npm run supabase:start
   ```

3. Serve Edge Functions with your secrets file (must include `HARDCOVER_API_KEY`). By default the serve script looks for `../book-discovery-plan/.env.local`; override with `BOOKNOOK_ENV_FILE`:

   ```bash
   # bash
   export BOOKNOOK_ENV_FILE=/path/to/.env.local
   npm run functions:serve
   ```

   ```powershell
   # PowerShell
   $env:BOOKNOOK_ENV_FILE = "C:\path\to\.env.local"
   npm run functions:serve
   ```

   See `supabase/functions/.env.example` for the expected variable names.

4. Serve the web app:

   ```bash
   npm run web:serve
   ```

   Open [http://127.0.0.1:4175](http://127.0.0.1:4175).

Inviting users and resetting the database locally are described in `docs/setup.md`.

## Tests and checks

| Command | What it does |
|---------|----------------|
| `npm run check:functions` | Deno type-check all Edge Functions |
| `npm run test:functions` | Deno unit tests (`tests/functions/`, stubbed `fetch`) |
| `npm run test:web` | `node --test` for pure web modules |
| `npm run test:db` | `supabase db reset` then pgTAP tests (needs local stack) |
| `npm run check:contract` | Contract presence check |
| `npm run verify:integration` | Integration gate against local stack and live APIs |

Automated tests do not call Simania, Hardcover, Wikidata or NLI; only the integration gate does.

## Harness workflow

Development tasks are executed by the agent harness (the `harness` command, from the private `agent-harness` repo) from task briefs under `tasks/`. Typical commands:

```bash
harness status
harness run <SPRINT>
harness resume <SPRINT>
harness failure <SPRINT>
```

Full orchestration details, safety rules and CLI reference: `README.md` and `HARNESS-OPERATOR.md` in the agent-harness repo.
