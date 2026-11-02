# Overview

## Components

- **Web app** (`public/`): static HTML, CSS and native ES modules. No build step, no framework. Talks to Supabase with `supabase-js` loaded from jsDelivr, pinned: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm`.
- **Supabase Postgres** (`supabase/migrations/`): catalog cache shared by all users, plus private per-user library tables protected by RLS.
- **Supabase Auth**: email and password, sign-up disabled, invited users.
- **Edge Functions** (`supabase/functions/`, Deno + TypeScript): everything that calls Hardcover, Wikidata or NLI, every write to catalog tables, and sending invites.
- **Browser Simania client** (`public/js/simania.js`): Simania's Cloudflare answers 403 to Supabase server IPs but allows CORS, so search, edition details and the Hebrew match for recommendations run in the browser. The browser passes the fetched Simania data to `add-book`, `book-details` and `link-edition`.
- **External APIs**: Simania MCP (Hebrew catalog), Hardcover GraphQL (identity, similarity, tags), Wikidata and NLI (title bridge).
- **Hosting**: GitHub Pages serves `public/`. A push to `main` runs `.github/workflows/release.yml`: tests, then `supabase db push` and all functions, then Pages (see `docs/deploy.md`).

## Who writes what

| Data | Written by |
|---|---|
| `works`, `editions` | Edge Functions with the service role only (`link-edition` links a browser-matched edition) |
| `shelves`, `shelf_books` | the signed-in user through supabase-js and the RPCs (`move_book`, `remove_book`, `set_rating`, ...); `add-book` inserts the first row |
| `recommendations` | the `recommendations` function and `link-edition`; the user may only set `dismissed` |
| `profiles` | sign-up trigger; the user updates own `display_name` and `locale` |
| `invitations` | the `invite-user` function; the sender may read own rows |
| `book_events` | a trigger on `shelf_books` only; the user may read own rows |
| `search_cache` | nothing (table remains, unused since `search-books` was removed) |

## Repository layout

```text
public/                    web app (served as static files)
design/library.html        approved visual design, reference only
prototype/test-page.html   earlier Codex test page, reference only
supabase/migrations/       SQL migrations
supabase/templates/        auth email templates (invite)
supabase/tests/            pgTAP database tests
supabase/functions/<name>/ one folder per Edge Function
supabase/functions/_shared/ shared Deno code; types.ts is the contract
tests/functions/           Deno unit tests for functions (mocked fetch)
tests/web/                 node --test tests for pure web modules
scripts/                   verification and site build scripts
.github/workflows/         release.yml: deploy on push to main
docs/contract.md           interface contract between lanes
```

## Invariants

1. Provider secrets (`HARDCOVER_API_KEY`) never reach the browser.
2. All Edge Functions verify the JWT.
3. A user can never read or change another user's shelves, shelf books, recommendations or profile.
4. One work per book: user state links to an edition, and the edition links to a work. A work may have several editions.
5. A failed or ambiguous match is stored as `not_found` with a timestamp only when every provider answered; a provider failure keeps the edition `pending` so a later request retries. A match is never guessed.
6. Displayed Hebrew titles and author names are stored exactly as Simania returns them. Normalization is only for matching.
7. Every loop over external requests is bounded (limits, timeouts, batch sizes).
8. Automated tests never call live external APIs. Only the integration gate does.
