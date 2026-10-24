# Overview

## Components

- **Web app** (`public/`): static HTML, CSS and native ES modules. No build step, no framework. Talks to Supabase with `supabase-js` loaded from jsDelivr, pinned: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm`.
- **Supabase Postgres** (`supabase/migrations/`): catalog cache shared by all users, plus private per-user library tables protected by RLS.
- **Supabase Auth**: email and password, sign-up disabled, invited users.
- **Edge Functions** (`supabase/functions/`, Deno + TypeScript): everything that calls Simania, Hardcover, Wikidata or NLI, and every write to catalog tables.
- **External APIs**: Simania MCP (Hebrew catalog), Hardcover GraphQL (identity, similarity, tags), Wikidata and NLI (title bridge).

## Who writes what

| Data | Written by |
|---|---|
| `works`, `editions`, `search_cache` | Edge Functions with the service role only |
| `shelves`, `shelf_books` | the signed-in user through supabase-js and the `move_book` RPC; `add-book` inserts the first row |
| `recommendations` | the `recommendations` function; the user may only set `dismissed` |
| `profiles` | sign-up trigger; the user updates own `display_name` and `locale` |

## Repository layout

```text
public/                    web app (served as static files)
design/library.html        approved visual design, reference only
prototype/test-page.html   earlier Codex test page, reference only
supabase/migrations/       SQL migrations
supabase/tests/            pgTAP database tests
supabase/functions/<name>/ one folder per Edge Function
supabase/functions/_shared/ shared Deno code; types.ts is the contract
tests/functions/           Deno unit tests for functions (mocked fetch)
tests/web/                 node --test tests for pure web modules
scripts/                   verification scripts
docs/contract.md           interface contract between lanes
```

## Invariants

1. Provider secrets (`HARDCOVER_API_KEY`) never reach the browser.
2. All Edge Functions verify the JWT. `search-books` is the only one that may be called by any signed-in user without touching user data.
3. A user can never read or change another user's shelves, shelf books, recommendations or profile.
4. One work per book: user state links to an edition, and the edition links to a work. A work may have several editions.
5. A failed or ambiguous match is stored as `not_found` with a timestamp. It is never guessed.
6. Displayed Hebrew titles and author names are stored exactly as Simania returns them. Normalization is only for matching.
7. Every loop over external requests is bounded (limits, timeouts, batch sizes).
8. Automated tests never call live external APIs. Only the integration gate does.
