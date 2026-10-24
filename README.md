# Torimitor

Local Hebrew book discovery prototype backed by Supabase Edge Functions.

## Architecture

- `search-books`: live catalog suggestions.
- `resolve-book`: Wikidata-first title resolution, verified on Hardcover, with NLI fallback.
- `recommendations`: combines Hardcover similarity lists and maps results back to Hebrew editions.
- `public/index.html`: browser UI with no catalog or recommendation logic and no private API key.

Shared integration code lives in `supabase/functions/_shared`.

## Run locally

Requirements: Docker Desktop and Node.js.

```powershell
npm.cmd install
npx.cmd supabase start
npx.cmd supabase functions serve --env-file ..\book-discovery-plan\.env.local --no-verify-jwt
npm.cmd run web:serve
```

Open `http://127.0.0.1:4175`.

The existing local `.env.local` is referenced only at runtime. Secrets are ignored by Git and never sent to the browser.

