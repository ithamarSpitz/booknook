# Edge Functions

All functions: POST with a JSON body, CORS for the web origin, JWT verified (`verify_jwt = true` in `supabase/config.toml`), errors as `{ "error": string }` with a 4xx or 5xx status. They create a service-role client for catalog writes and a user-scoped client (from the request's Authorization header) for user data. Exact request and response types live in `supabase/functions/_shared/types.ts` once the contract sprint is done.

## search-books (exists)

- In: `{ query: string }`. Queries shorter than 2 characters return `[]`.
- Out: `{ books: SimaniaBook[] }`, at most 8.
- Behavior: Simania `books_search`. Optional read-through `search_cache` (24 hours).

## add-book (replaces resolve-book)

- In: `{ simania_id: number, shelf_id: string }`.
- Out: `{ book: BookCard, resolve_status }`.
- Behavior:
  1. Upsert the `editions` row from Simania `books_get_details` and `books_get_rating` if missing or older than 30 days.
  2. If `resolve_status` is `pending`, or `not_found` older than 14 days, resolve to Hardcover (see `matching.md`) and upsert `works`.
  3. Insert the caller's `shelf_books` row at the end of the shelf. If the book is already on one of the caller's shelves, return 409.
  4. Return the card data.
- Never fails the add because resolution failed: the book is shelved with `work_id` null.

## book-details

- In: `{ simania_id: number }`. Out: `{ book: BookCard }`.
- Behavior: step 1 of add-book only. Used for recommendation cards.

## recommendations (exists, changes needed)

- In: `{}`. The user comes from the JWT.
- Out: `{ recommendations: RecommendationCard[] }`, at most 20.
- Behavior:
  1. Seeds: the caller's books on `read` and `reading` shelves with a non-null `work_id`. More than 8 seeds: take `reading` first, then `read` by `finished_at` desc, then `added_at` desc, up to 8.
  2. Candidate score: for each seed, the first 40 `works.similar_ids`, score `1 - rank/40`, summed across seeds.
  3. Exclude: works of any book on any of the caller's shelves (including want and stopped), and dismissed recommendations.
  4. Load missing candidate works from Hardcover in batches of 50; upsert `works`.
  5. Localize the top candidates to Hebrew editions (see `matching.md`), 5 in parallel, stop at 20 results or 40 attempts. Keep English-only results with `simania_id` null.
  6. `shared_tags`: tags present on the candidate and on at least one of its seeds.
  7. Replace the caller's non-dismissed rows in `recommendations`, return them.
- Zero seeds returns `{ recommendations: [] }` with status 200.

## Shared code

`_shared/` keeps the existing `simania.ts`, `hardcover.ts`, `bridges.ts`, `utils.ts`, and adds `types.ts` (contract), `db.ts` (service and user clients). Functions import `supabase-js` as `npm:@supabase/supabase-js@2.45.4`.
