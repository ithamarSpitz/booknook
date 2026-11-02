# Edge Functions

All functions: POST with a JSON body, CORS for the web origin, JWT verified (`verify_jwt = true` in `supabase/config.toml`), errors as `{ "error": string }` with a 4xx or 5xx status. They create a service-role client for catalog writes and a user-scoped client (from the request's Authorization header) for user data. Exact request and response types live in `supabase/functions/_shared/types.ts`; `docs/contract.md` has the binding details.

No Edge Function calls Simania in production: Simania's Cloudflare answers 403 to Supabase server IPs. The browser (`public/js/simania.js`) searches Simania and fetches edition details, and passes them to functions as an optional `simania` field `{ details, rating }`. When that field is absent a function tries Simania directly (works only off-cloud) and otherwise keeps an existing cached row.

## Search (browser only)

The `search-books` function was removed. Search runs in the browser: under 2 characters returns `[]` without a call, otherwise one Simania `books_search` with `limit: 8`. `search_cache` is no longer written.

## add-book (replaces resolve-book)

- In: `{ simania_id: number, shelf_id: string, simania?: { details, rating } }`. The browser always sends `simania`.
- Out: `{ book: BookCard, resolve_status }`.
- Behavior:
  1. Upsert the `editions` row from the supplied Simania details and rating if missing or older than 30 days.
  2. If `resolve_status` is `pending`, or `not_found` older than 14 days, resolve to Hardcover (see `matching.md`) and upsert `works`. A provider failure keeps `pending`.
  3. Insert the caller's `shelf_books` row at the end of the shelf. Return 409 if this edition is already on one of the caller's shelves, or if another edition with the same non-null `work_id` is.
  4. Return the card data.
- Never fails the add because resolution failed: the book is shelved with `work_id` null.

## book-details

- In: `{ simania_id: number, simania?: { details, rating } }`. Out: `{ book: BookCard }`.
- Behavior: step 1 of add-book; if the edition is still `pending`, also step 2. Never shelves. Used for recommendation cards.

## recommendations

- In: `{}`. The user comes from the JWT.
- Out: `{ recommendations: RecommendationCard[] }`, at most 20.
- Behavior:
  1. Seeds: the caller's books with a non-null `work_id` and a positive weight. Weight is the reader's rating when it is 3-5 (any shelf), 2.5 for an unrated book on `read`, otherwise 0. No seed cap. Seeds are ordered by weight, then `finished_at` desc, then `added_at` desc.
  2. Candidate score: for each seed, the first 40 `works.similar_ids`, score `weight * (1 - rank/40)`, summed across seeds.
  3. Exclude: works of any book on any of the caller's shelves (including want and stopped), and dismissed recommendations.
  4. Load missing candidate works from Hardcover in batches of 50; upsert `works`.
  5. Localize the top candidates (see `matching.md`), 5 in parallel, stop at 20 results or 40 attempts. The function finds only the Hebrew title (Wikidata, then NLI) and returns it as `hebrew_hint`; the browser matches it on Simania and calls `link-edition`. Until then, and on a miss, the card is English-only with `simania_id` null: Hardcover title and cover, dismiss but not add-to-shelf.
  6. `shared_tags`: tags present on the candidate and on at least one of its seeds.
  7. Replace the caller's non-dismissed rows in `recommendations`, return them.
- Zero seeds returns `{ recommendations: [] }` with status 200.
- The browser regenerates recommendations in the background (`public/js/recs-refresh.js`, debounced) after every shelf change.

## link-edition

- In: `{ work_id, simania_id, source: "wikidata" | "nli", simania: { details, rating } }`. Out: `{ work_id, simania_id, title, author, cover_url }`.
- Behavior: the caller must have a non-dismissed recommendation for `work_id` (404 otherwise). Store the edition with the 30-day rule, link it to the work only while its `work_id` is null, keep an existing link to the same work, and answer 409 if it links to a different work (never relink). On success set the caller's recommendation `simania_id`.

## invite-user

- In: `{ email: string }`. Out: `{ invitation: { email, created_at } }`.
- Behavior: any signed-in user may invite. At most 10 invitations per user per 24 hours (429). Sends the Supabase invite email (template `supabase/templates/invite.html`, names the inviter from `profiles.display_name`), then stores an `invitations` row. Hebrew errors: invalid email 400, existing account 409, mail rate limit 429, mailer refused 502.

## Shared code

`_shared/` holds `simania.ts`, `hardcover.ts`, `bridges.ts`, `catalog.ts`, `utils.ts`, `types.ts` (contract) and `db.ts` (service and user clients). Functions import `supabase-js` as `npm:@supabase/supabase-js@2.45.4`.
