# BookNook binding interface contract

This is the binding interface for sprint S1. SQL, JSON, and TypeScript names are identical unless a view-model table states otherwise. UUIDs are JSON strings and `timestamptz` values are ISO-8601 strings. All tables are in `public`.

## Shared values

| PostgreSQL / TypeScript type | Exact values |
|---|---|
| `shelf_kind` / `ShelfKind` | `reading`, `read`, `want`, `stopped`, `custom` |
| `resolve_status` / `ResolveStatus` | `pending`, `wikidata`, `nli`, `fuzzy`, `llm`, `not_found`, `hardcover`, `original_title`, `nli_author`, `omnibus`, `series` |

`llm` is reserved and is never produced in this build. `hardcover` marks an English edition (below). `original_title` marks an edition linked by the off-cloud repair script (below). Simania display text is stored and returned unchanged; normalization is only for matching.

## Database rows

### `profiles`

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `id` | `uuid` | no | PK; references `auth.users(id)` on delete cascade |
| `display_name` | `text` | no | `''` |
| `locale` | `text` | no | `'he'` |
| `created_at` | `timestamptz` | no | `now()` |
| `genre_shelf_count` | `smallint` | no | `10`; check `genre_shelf_count between 1 and 20` (S17) |

RLS permits select and update only where `id = auth.uid()`. Clients have column-level update grants only for `display_name` and `locale`; no client insert/delete or update of other columns.

`genre_shelf_count` gets no client update grant; it changes only through `set_genre_shelf_count`.

### `works`

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `id` | `uuid` | no | PK; `gen_random_uuid()` |
| `hardcover_id` | `integer` | yes | unique |
| `original_title` | `text` | no | none |
| `original_authors` | `text[]` | no | `'{}'` |
| `similar_ids` | `integer[]` | no | `'{}'`; Hardcover `cached_similar_book_ids` |
| `tags` | `jsonb` | no | `'{}'`; Hardcover cached tags |
| `hardcover_cover_url` | `text` | yes | none |
| `refreshed_at` | `timestamptz` | yes | none |

Authenticated clients may select; only service-role Edge Functions write.

`tags` uses `CachedTags`: a category-keyed object whose arrays contain objects with a non-empty string `tag`, for example `{"Genre":[{"tag":"fantasy"}],"Mood":[{"tag":"reflective"}]}`. These are retained provider tag names, not inferred labels. At ingestion, accept only array-valued categories and object entries with a non-blank string `tag`; discard malformed entries and use `{}` for absent/null/non-object caches. Preserve valid tag strings unchanged; other provider metadata may be retained but never affects matching. For recommendations, extract only `Genre` and `Mood` entries, in that category order and then provider array order. Compare tag strings exactly (case-sensitive, no trimming, translation or normalization), irrespective of category; deduplicate by exact string. `shared_tags` is the candidate's extracted list filtered to names present in the union of its contributing seeds' extracted lists, preserving candidate order. Missing categories contribute no names.

### `editions`

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `simania_id` | `integer` | no | PK |
| `work_id` | `uuid` | yes | references `works(id)`; indexed |
| `resolve_status` | `resolve_status` | no | `'pending'` |
| `resolved_at` | `timestamptz` | yes | none |
| `title` | `text` | no | none |
| `author` | `text` | yes | none |
| `translator` | `text` | yes | none |
| `publisher` | `text` | yes | none |
| `series` | `text` | yes | none |
| `category` | `text` | yes | none |
| `year` | `integer` | yes | none |
| `pages` | `integer` | yes | none |
| `description` | `text` | yes | none |
| `cover_url` | `text` | yes | none |
| `simania_rating` | `numeric(3,2)` | yes | none |
| `simania_rating_count` | `integer` | yes | none |
| `details_at` | `timestamptz` | yes | none |

Authenticated clients may select; only service-role Edge Functions write. Null `work_id` means unresolved or unavailable on Hardcover and never prevents shelving.

**English editions.** A book that is not on Simania can be shelved as its English Hardcover edition: an `editions` row with `simania_id = -hardcover_id` (always negative; Simania IDs are always positive), `work_id` set to that Hardcover work, `resolve_status = 'hardcover'` and `resolved_at` now. It never goes through the Hebrew resolution procedure, Wikidata, NLI or Simania. Its display fields come from the Hardcover book: `title` = Hardcover `title`; `author` = cached contributor names joined with `, ` (null if none); `publisher` = `default_physical_edition.publisher.name`; `year` = `release_year`; `pages` = `pages`, else `default_physical_edition.pages`; `description` = `description` as plain text (`<br>` and `</p>` become a newline, other tags are removed, HTML entities decoded, runs of more than two newlines collapsed, trimmed; null if empty); `cover_url` = `image.url`; `simania_rating` = `rating` rounded to 2 decimals (Hardcover and Simania both rate 0 to 5); `simania_rating_count` = `ratings_count`; `translator`, `series`, `category` null; `details_at` now. Refresh these fields from Hardcover when `details_at` is at least 30 days old. The work row is upserted exactly as the resolver upserts an accepted Hardcover book. Since the edition has the work's `work_id`, the shelf trigger's same-work rule already prevents shelving both a Hebrew and an English edition of one work.

### `shelves`

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `id` | `uuid` | no | PK; `gen_random_uuid()` |
| `user_id` | `uuid` | no | references `auth.users(id)` on delete cascade |
| `name` | `text` | no | none |
| `kind` | `shelf_kind` | no | `'custom'` |
| `position` | `integer` | no | none |
| `created_at` | `timestamptz` | no | `now()` |

`(user_id, position)` is unique, deferrable, initially deferred. `(user_id, kind)` is unique where `kind <> 'custom'`. RLS permits operations only where `user_id = auth.uid()`; direct client inserts must use `custom`. Client grants allow select, insert, and update of `name` only (custom shelves only); revoke table-level UPDATE and DELETE. Direct position updates and direct deletion, including custom shelves, are forbidden; use `move_shelf` and `delete_shelf` through the protected write mechanism below. A custom-shelf insert trigger takes the same per-user profile lock as the RPCs, then assigns the current shelf count to `NEW.position`, overriding the supplied position so creation appends without gaps. A `BEFORE UPDATE` trigger rejects changes to `id`, `user_id`, or `kind` with `22023`, for custom and built-in shelves alike. A `BEFORE DELETE` trigger rejects non-custom deletion with `22023` while the owning `auth.users` row exists; deletion cascading from removal of that user is allowed. Together with atomic creation of the four built-ins, these protections and the partial unique index guarantee exactly one shelf of each non-custom kind for each existing user. A built-in cannot become custom or be transferred to another user.

### `shelf_books`

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `user_id` | `uuid` | no | references `auth.users(id)` on delete cascade; PK part 1 |
| `simania_id` | `integer` | no | references `editions`; PK part 2 |
| `shelf_id` | `uuid` | no | references `shelves` on delete cascade |
| `position` | `integer` | no | none |
| `added_at` | `timestamptz` | no | `now()` |
| `finished_at` | `timestamptz` | yes | none |
| `rating` | `smallint` | yes | check 1 through 5; currently unused |

`(shelf_id, position)` is unique, deferrable, initially deferred. A check/trigger guarantees the shelf belongs to `user_id`. RLS permits operations only where `user_id = auth.uid()`. Revoke table-level `INSERT`, `UPDATE`, and `DELETE` from clients; grant only `SELECT` plus `INSERT (user_id, simania_id, shelf_id)`. Consequently a client cannot supply `position`, `added_at`, `finished_at`, or `rating`. Every insert passes through the authoritative `BEFORE INSERT` append/duplicate trigger specified under `add-book`: it assigns `position`, overwrites `added_at` with `now()`, sets `finished_at` to `now()` exactly when the initial target shelf is `read` and otherwise to null, and sets `rating` to null. These assignments also override values supplied by a privileged caller. Updates and deletes use the protected RPC write mechanism below: identity (`user_id`, `simania_id`) and `added_at` are immutable, movement uses `move_book`, removal uses `remove_book`, and the reader's own 1-5 rating uses `set_rating`. The PK ensures one row per edition/user; `add-book` separately enforces one non-null work per user. A duplicate created by later resolution is tolerated, but is still excluded from recommendations by work.

### `recommendations`

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `user_id` | `uuid` | no | references `auth.users(id)` on delete cascade; PK part 1 |
| `work_id` | `uuid` | no | references `works`; PK part 2 |
| `simania_id` | `integer` | yes | references `editions`; null is English-only; check `simania_id is null or simania_id > 0` (never an English edition) |
| `score` | `real` | no | none |
| `because` | `integer[]` | no | seed Simania IDs |
| `shared_tags` | `text[]` | no | `'{}'` |
| `dismissed` | `boolean` | no | `false` |
| `generated_at` | `timestamptz` | no | `now()` |

RLS permits select where `user_id = auth.uid()`. Revoke table-level `UPDATE` from clients and grant only `UPDATE (dismissed)` on their own rows; the service role performs all other writes. Dismissal is one-way: a `BEFORE UPDATE OF dismissed` trigger permits `false -> true`, `false -> false`, and `true -> true`, but rejects `true -> false` with `22023`, for clients and the service role alike. Dismissed works therefore remain stored and excluded permanently.

### `genre_recommendations`

Recommendation shelves by genre, shown below the reader's own shelves.

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `user_id` | `uuid` | no | references `auth.users(id)` on delete cascade; PK part 1 |
| `work_id` | `uuid` | no | references `works`; PK part 2 (a work is on at most one genre shelf) |
| `genre_key` | `text` | no | genre key (see "Genre keys and names (S17)"); the migration fills existing rows with their `genre` value |
| `genre` | `text` | no | the genre's display name |
| `shelf_position` | `smallint` | no | 0-19, shelf order |
| `position` | `smallint` | no | 0-11, book order within the shelf |
| `simania_id` | `integer` | yes | references `editions`; null is English-only; check `simania_id is null or simania_id > 0` (never an English edition) |
| `score` | `real` | no | none |
| `because` | `integer[]` | no | `'{}'`; seed Simania IDs that contributed, highest contribution first, at most 10 |
| `generated_at` | `timestamptz` | no | `now()` |

RLS: a user may only `SELECT` own rows; clients get no write grants. Writes go only through `replace_genre_recommendations`.

### `dismissed_works`

Books the reader removed from the Recommendations page or from a genre shelf (S15). One row per reader and work, for both places.

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `user_id` | `uuid` | no | references `auth.users(id)` on delete cascade; PK part 1 |
| `work_id` | `uuid` | no | references `works(id)` on delete cascade; PK part 2 |
| `kind` | `text` | no | check `kind in ('hide', 'not_my_type')` |
| `dismissed_at` | `timestamptz` | no | `now()` |

- `hide` ("הסר"): the work is never recommended again, and nothing else changes (weight 0).
- `not_my_type` ("לא הסגנון שלי"): the work is never recommended again, and it is a **negative seed** with weight 5 (see "Recommendation scoring" and "Books per genre").

RLS: a user may only `SELECT` own rows; clients get no write grants. Writes go only through two RPCs (security definer, `search_path = public`, execute granted only to `authenticated`, using `auth.uid()`; a null `auth.uid()` raises `42501`):
- `dismiss_work(p_work_id uuid, p_kind text) returns void`: `p_kind` not in the two kinds raises `22023`; a missing work raises `23503`. Upserts the row; dismissing an already dismissed work replaces its `kind` and `dismissed_at`. In the same transaction: sets this user's `recommendations.dismissed = true` for that work if a row exists, and deletes this user's `genre_recommendations` rows for that work.
- `restore_work(p_work_id uuid) returns void`: deletes this user's `dismissed_works` row and this user's `recommendations` row for that work (dismissed or not), so the next regeneration may recommend it again. Restoring a work that is not dismissed does nothing.
- `set_genre_preference(p_genre_key text, p_label text, p_state text) returns void` (S17): security definer, caller = `auth.uid()`, execute granted only to `authenticated`. `p_state` not in `auto`, `pinned`, `hidden`, or a blank `p_genre_key` or `p_label`, raises `22023`. `auto` deletes the caller's row for that key. `hidden` upserts the row with `pin_order` null. `pinned` upserts it; a genre that is already pinned keeps its `pin_order`, otherwise `pin_order` = the caller's current highest `pin_order` + 1 (0 when none). Pinning a 20th genre (19 already pinned) raises `22023`. Every write sets `label` and `updated_at`.
- `set_genre_shelf_count(p_count integer) returns void` (S17): security definer, caller = `auth.uid()`, execute granted only to `authenticated`. Outside 1-20 raises `22023`. Sets the caller's `profiles.genre_shelf_count`.

Migration backfill: every `recommendations` row with `dismissed = true` becomes a `dismissed_works` row with `kind = 'hide'` and `dismissed_at = generated_at` (skip conflicts). Clients lose the `UPDATE (dismissed)` grant on `recommendations`; the one-way `dismissed` trigger stays (`restore_work` deletes the row instead of flipping it). Dismissing goes only through `dismiss_work`.

### `genre_preferences`

The reader's choices for genre shelves (S17). A genre with no row is automatic.

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `user_id` | `uuid` | no | references `auth.users(id)` on delete cascade; PK part 1 |
| `genre_key` | `text` | no | PK part 2; non-empty |
| `label` | `text` | no | display name when the choice was made; non-empty |
| `state` | `text` | no | check `state in ('pinned','hidden')` |
| `pin_order` | `integer` | yes | not null exactly when `state = 'pinned'` |
| `updated_at` | `timestamptz` | no | `now()` |

RLS: a user may only `SELECT` own rows. Clients get no write grants; writes go only through `set_genre_preference`.

### `reader_genres`

The genres the latest `recommendations` run found for this reader (S17), listed by the shelf settings page.

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `user_id` | `uuid` | no | references `auth.users(id)` on delete cascade; PK part 1 |
| `genre_key` | `text` | no | PK part 2 |
| `label` | `text` | no | display name |
| `seed_count` | `integer` | no | check `>= 0` |
| `candidate_count` | `integer` | no | check `>= 0` |
| `position` | `smallint` | no | 0-99 |
| `generated_at` | `timestamptz` | no | `now()` |

RLS: a user may only `SELECT` own rows; clients get no write grants. Writes go only through `replace_reader_genres`.

### `search_cache`

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `query_norm` | `text` | no | PK |
| `results` | `jsonb` | no | serialized `SimaniaBook[]` |
| `fetched_at` | `timestamptz` | no | `now()` |

RLS has no client policies; service role only. Entries are fresh for 24 hours.

## Trigger

`handle_new_user() returns trigger` runs after insert on `auth.users`. It creates a profile, taking a non-empty `raw_user_meta_data->>'display_name'` or else the email local part, with locale `he`. It creates exactly these zero-based shelves:

| Position | Name | Kind |
|---:|---|---|
| 0 | קורא עכשיו | `reading` |
| 1 | קראתי | `read` |
| 2 | רוצה לקרוא | `want` |
| 3 | הפסקתי | `stopped` |

It returns `new`. It is security-definer with a fixed safe search path; failure aborts user creation atomically.

## RPCs

The four library RPCs below are `security invoker`, use `auth.uid()`, are atomic, and return SQL `void` (JSON `null`). Positions are zero-based; out-of-range positions are rejected, not clamped. Ownership failures do not disclose another user's rows. Before reading positions or changing library rows, each RPC locks the caller's `profiles` row with `SELECT ... FOR UPDATE`. The insert trigger described under `add-book` takes this same per-user lock before duplicate checks and position allocation. Locks last until transaction end; use READ COMMITTED and read positions in a separate statement after obtaining the lock so a waiter sees the preceding commit.

**Protected writes with invoker RPCs.** RLS ownership policies do not themselves authorize direct writes: the table/column grants above also apply. Keep the four public RPCs security-invoker wrappers; each delegates to a corresponding security-definer helper in a private schema that is not exposed by PostgREST. Each helper has the same arguments and result as its wrapper and implements the entire corresponding operation below, including authentication, ownership checks, profile locking, bounds, renumbering, and timestamp rules. Use a fixed safe search path and schema-qualified relations. Revoke helper execution from PUBLIC and anon; grant authenticated only the schema USAGE and helper EXECUTE needed by the invoker wrappers. Even a direct SQL invocation of a helper must enforce every rule; accept no caller-supplied user ID, arbitrary SQL, or bypass flag. The helper's owner has the required table privileges; if it bypasses RLS, explicit `auth.uid()` predicates on every affected user row remain mandatory. Do not grant clients table UPDATE/DELETE merely to make invoker RPCs work, and do not rely on a client-settable session variable to authorize writes. This preserves caller ownership while preventing direct REST/SQL mutations from bypassing the RPC algorithms. Only account-deletion cascades may remove library rows without these algorithms.

**Position bounds.** Compute counts after acquiring the profile lock and validating ownership, before mutation. Reject null or out-of-range positions with `22023`; parameters are SQL integers. For a cross-shelf `move_book`, let `N` be the target's current book count: valid positions are `0..N` inclusive, and `N` appends (an empty target accepts only `0`). For a same-shelf move, let `M` be its count including the moved book: remove that book conceptually first, then insert at a final index in `0..M-1` inclusive; `M-1` appends after the remaining books, and `M` is invalid. For `move_shelf`, let `S` be the caller's shelf count including the moved shelf: valid final indices are `0..S-1` inclusive, after conceptual removal; `S` is invalid. A move to the existing index preserves order. Preserve the relative order of all other rows and finish with contiguous positions starting at zero. For example, a target with three books accepts cross-shelf index `3`, but a same-shelf move among three books accepts at most `2`; four shelves accept at most `3`.

| RPC | Typed arguments | Behavior |
|---|---|---|
| `move_book` | `p_simania_id integer`, `p_to_shelf uuid`, `p_to_position integer` | Requires caller-owned book and target shelf. Closes the source gap, opens the target slot, and leaves both shelves contiguous. Same-shelf moves are stable. Sets `finished_at = now()` only the first time the book reaches `read`; never clears/overwrites it. |
| `move_shelf` | `p_shelf_id uuid`, `p_to_position integer` | Moves a caller-owned shelf and makes that user's positions contiguous. |
| `delete_shelf` | `p_shelf_id uuid` | Custom only. Appends its books in existing order after the caller's last `want` book, deletes it, and closes the shelf gap. |
| `remove_book` | `p_simania_id integer` | Deletes the caller's row and closes its old shelf gap; catalog rows remain. |
| `set_rating` | `p_simania_id integer, p_rating smallint` | Sets the caller's 1-5 rating for a shelved book on any shelf; null clears it. Recommendations weight seeds by it: 3-5 on any shelf, 2.5 when unrated on `read` (internal only), otherwise not a seed. |

The TS interfaces `MoveBookArgs`, `MoveShelfArgs`, `DeleteShelfArgs`, and `RemoveBookArgs` use those exact parameter keys. Their corresponding result types are `MoveBookResult`, `MoveShelfResult`, `DeleteShelfResult`, and `RemoveBookResult`, each exactly `null`. Errors: unauthenticated `42501`; an absent row and a row not owned by the caller both produce `P0002` with the same message; invalid position or non-custom deletion `22023`; constraint conflict `23505`/`23514`. An RPC must apply the ownership predicate in its lookup and must not perform a separate existence check that could distinguish those two `P0002` cases.

```json
{"rpc":"move_book","args":{"p_simania_id":1234,"p_to_shelf":"7d94c068-7489-4aea-9e13-78c1113df4f7","p_to_position":0},"result":null}
```

### Service-only genre recommendation replacement

`replace_genre_recommendations(p_user_id uuid, p_rows jsonb) returns void`: transactional, security-invoker, execute granted only to service_role (revoked from PUBLIC, anon, authenticated). `p_rows` is an array of at most 240 `GenreRecommendationReplacement` objects (`work_id`, `genre_key` non-empty string, `genre` non-empty, `shelf_position` 0-19, `position` 0-11, nullable positive `simania_id`, finite `score`, optional `because`, an array of at most 10 distinct non-zero integers, stored as `{}` when absent); work IDs distinct; a non-null edition must belong to its work; at most 12 rows per `genre_key`. An unknown or missing key in the object still raises `22023`, as for the other fields. Invalid payloads raise `22023`, missing references `23503`. Lock the user's `profiles` row first (same lock order as the other RPCs), delete all of this user's rows, insert the payload except works now on this user's shelves, with one `clock_timestamp()` as `generated_at`. Empty input clears the user's rows.

### Service-only reader genre replacement

`replace_reader_genres(p_user_id uuid, p_rows jsonb) returns void` (S17): transactional, security-invoker, execute granted only to service_role. `p_rows` is an array of at most 100 objects with exactly `genre_key` (non-empty string), `label` (non-empty string), `seed_count` and `candidate_count` (integers `>= 0`), `position` (integer 0-99, unique). A bad payload raises `22023` and changes nothing; an unknown profile raises `23503`. Deletes all of that user's `reader_genres` rows and inserts the new ones with one shared `generated_at`.

### Service-only recommendation replacement

`replace_recommendations(p_user_id uuid, p_rows jsonb) returns setof public.recommendations` is a single transactional, security-invoker RPC called only by the recommendations Edge Function using its service client after JWT verification. Revoke execution from PUBLIC, anon and authenticated; grant only to service_role. `p_user_id` must be the verified caller's ID, never a request-body value. `p_rows` is an array of at most 20 `RecommendationReplacement` objects, each containing exactly `work_id`, nullable `simania_id`, finite `score`, `because` (integer array), and `shared_tags` (string array). Work IDs must be distinct; a non-null edition must belong to that work. Invalid payloads raise `22023`, missing user/catalog references `23503`; failure rolls back the entire operation.

First lock `public.profiles` for `p_user_id` with `SELECT ... FOR UPDATE`; a missing profile raises `23503`. This is the same per-user lock and the same lock order used by `add-book`: profile first, recommendations second. After obtaining it, acquire `LOCK TABLE public.recommendations IN SHARE ROW EXCLUSIVE MODE` before reading or writing recommendations. The profile lock serializes the final shelf recheck with additions; the table lock serializes replacement transactions and direct dismissals. Committed shelves and dismissals at lock acquisition are therefore observed.

Within this transaction, capture one `clock_timestamp()` value, re-read the user's shelved work IDs only after both locks are held, retain all dismissed rows, delete this user's non-dismissed rows, and insert the payload excluding any retained dismissed work and any work now on this user's shelves. Set `dismissed = false` and the captured `generated_at` on every inserted row. Return only inserted rows ordered by score descending, then joined `works.hardcover_id` ascending. Empty input clears non-dismissed rows and returns `[]`. Concurrent generations replace whole sets in lock order, never partial or mixed sets. The `add-book` insertion path deletes a matching non-dismissed recommendation while it holds the same profile lock, so either transaction order preserves the shelf-exclusion invariant: replacement after addition sees the shelf, and addition after replacement removes the row. The function maps returned rows to cards; it must not separately delete/upsert via REST or return the unfiltered payload. Locks are held only during this short database operation, never during provider requests.

Types: `ReplaceRecommendationsArgs` and `ReplaceRecommendationsResult` (`RecommendationRow[]`). Example: `{"rpc":"replace_recommendations","args":{"p_user_id":"7d94c068-7489-4aea-9e13-78c1113df4f7","p_rows":[]},"result":[]}`. This service-only RPC is intentionally absent from the browser's `RPCS` constants.

## Edge Functions

All accept `POST` JSON plus bearer JWT and return JSON with CORS headers; `OPTIONS` is preflight. Success is `200`. Errors are `{"error":"message"}`: malformed/invalid body `400`, missing/invalid JWT `401`, unsupported method `405`, unexpected/configuration failure `500`, and upstream failure `502`. Shared provider timeout is 12 seconds; Hardcover GraphQL uses 18 seconds. Secrets are never returned.

### Large ID lists (S20)

Every Edge Function query that filters a column by a list of values (PostgREST `in`) sends at most 100 values per request, through the shared helper `selectInChunks` in `supabase/functions/_shared/chunked.ts`. The helper splits the list, runs the chunks at most 4 at a time, and concatenates their rows. Any chunk error fails the whole lookup, exactly like a single failed query today. Callers that relied on one query keep their behavior: the same rows, in any order, with no duplicates for distinct input values.

Measured 2026-11-19: one reader's `recommendations` call (about 250 rated books, so thousands of similar-book Hardcover IDs) answered `500` in 1.6 s with "error sending request ... /rest/v1/works?select=*&hardcover_id=in.(...)": the URL was too long. Her recommendations and genre shelves had not been regenerated since 2026-11-10.

### Simania runs in the browser

Simania's Cloudflare answers `403` to Edge Function (data-center) IPs and allows CORS from any origin, so **no Edge Function calls Simania**; `public/js/simania.js` calls the MCP endpoint from the reader's browser. Search is browser-only: trim the query; under 2 characters returns `[]` without a call; otherwise call `books_search` once with `limit: 8, offset: 0` and keep the real `SimaniaBook` fields. A Simania failure is shown as an error in the search panel. `search_cache` is no longer written (the `search-books` function was removed).

Functions that need edition data take an optional `simania` field `{"details": <raw books_get_details object>, "rating": <raw books_get_rating object or null>}` that the browser fetched just before the call. The server trusts it (about 10 invited users) and maps it with the same field rules as before. Wherever this contract says "call Simania `books_get_details` and `books_get_rating`", read: use the supplied `simania` field; when it is absent, try Simania directly (works only off-cloud), and when that fails keep an existing cached row unchanged instead of failing.

### `search-english`

Request `SearchEnglishRequest`: `{"query":"spin robert charles wilson"}`. Response `SearchEnglishResponse`: `{"books":[{"hardcover_id":383752,"title":"Spin","author":"Robert Charles Wilson","year":2005,"cover_url":"https://..."}]}`. Trim the query; under 2 characters returns `{"books":[]}` without a call. Otherwise one Hardcover Book search (`per_page=8`) and one batch read of the returned IDs, returned in search order; `author` is the cached contributor names joined with `, ` or null. Hardcover failure is `502`. Requires a signed-in user.

### `add-book`

An English edition: request `{"hardcover_id":383752,"shelf_id":"..."}` (no `simania`). Exactly one of `simania_id` or `hardcover_id` (positive integers) is required (`400`). Create or refresh the English edition `-hardcover_id` as described under `editions` (unknown Hardcover ID is `404`, Hardcover failure `502`), then insert into `shelf_books` exactly as for a Simania edition, with the same `409` duplicate rules; the response is the same `AddBookResponse` with `resolve_status` `hardcover`.

A Simania edition: request `AddBookRequest`: `{"simania_id":1234,"shelf_id":"7d94c068-7489-4aea-9e13-78c1113df4f7","simania":{"details":{"title":"ספר"},"rating":null}}` (the browser always sends `simania`). Response is `AddBookResponse`:

```json
{"book":{"simania_id":1234,"work_id":null,"resolve_status":"not_found","title":"ספר","author":null,"translator":null,"publisher":null,"series":null,"category":null,"year":null,"pages":null,"description":null,"cover_url":null,"simania_rating":null,"simania_rating_count":null,"shelf_id":"7d94c068-7489-4aea-9e13-78c1113df4f7","shelf_name":"רוצה לקרוא","shelf_kind":"want","position":3,"added_at":"2026-10-25T10:00:00Z","finished_at":null,"rating":null},"resolve_status":"not_found"}
```

Require caller-owned shelf. If edition is absent or `details_at` is at least 30 days old, call Simania `books_get_details` and `books_get_rating`, upsert every edition display/rating field, and set `details_at` now.

Resolve when `pending`, or `not_found` at least 14 days old, using the following bounded deterministic procedure. All similarities below are the normalized word-set Dice value: normalize with NFKD, strip U+0300--U+036F combining marks, lowercase, remove one leading English `the`, `a`, or `an`, replace non-letter/digit runs with one space, trim, then compute `2 * |intersection| / (|left set| + |right set|)`; an empty set scores zero. Equal-score ties retain provider order unless a numeric-ID tie-break is stated.

0. **Match title.** Every step below uses the edition's *match title*: the Simania title with trailing edition labels removed, repeatedly: a final parenthesized part `( ... )` and a final bracketed part `[ ... ]` (live cases: `חפצים חדים (2015)`, `ההיסטוריה הסודית [מהדורת מודן - 2015]`, `הנסיכה הקסומה [מהדורת 2018]`, `מחר ועוד מחר ועוד מחר [עטיפה חדשה]`, `עין החתול [מהדורת 2011]`), then trimmed. If that leaves nothing, use the trimmed Simania title. The stored display title never changes.

   **Edition labels (S26).** `matchTitle` also removes a trailing ` - ` or ` – ` segment (a hyphen or en dash with a space on each side) when that segment contains `מהדורה`, `מהדורת`, `עטיפת`, `כריכה`, `הדפסה` or `כרכים`. This repeats together with the `[...]` and `(...)` rules above, until nothing changes. It never returns an empty string. Examples: `התלקחות - משחקי הרעב 2 - כריכה קשה` becomes `התלקחות - משחקי הרעב 2`; `אידיוט - כרכים א'-ב' [מהדורת 1993]` becomes `אידיוט`; `יומני רובורצח - כרך 1` is unchanged. Live cases: `בורות - מהדורת 2003` (Holes) now resolves through `בורות`.

   **Box sets (S31).** An edition is a box set when its match title contains one of the words `מארז`, `טרילוגיית`, `טרילוגיה`, `ערכת` or `סט`, as a whole word (bounded by start, end, space, `-`, `–`, `(`, `)`, `[` or `]`).
   - For a box set, the bridges run on the **box core**: the match title with those words and the words `מלא`, `דיגיטלי` and `דיגיטלית` removed. Then split it on ` - ` and ` – `, keep the longest part, and trim it.
   - The Hardcover match for a box set tries, in order, `"<bridge title> Trilogy"`, `"<bridge title> Collection"` and `"<bridge title> Box Set"`. It accepts the first book whose title contains `Trilogy`, `Collection`, `Box Set`, `Boxed Set` or `Omnibus` (case-insensitive) and that has author evidence. Title Dice is computed with those words removed from both sides.
   - A box set is never linked to a book without such a word. With no accepted book, it is `not_found`.
   - The direct fuzzy fallback does not run for box sets.
   - Measured on prod 2026-11-21: 980165 `טרילוגיית משחקי הרעב` (a shelved box set) was linked to 88639 `The Hunger Games` (book 1); it now gives 593165 `The Hunger Games Trilogy`. 1020813 `מארז דיגיטלי – מורשת הותורן` was linked to 428546 `The Inheritance Games` (book 1); it now gives 677935 `The Inheritance Games Collection`. Hardcover's `compilation` flag is unreliable (88639 has `compilation: true`), so it is not used.

1. **Wikidata bridge.** Make one Hebrew `wbsearchentities` item search with `limit=8`, but inspect at most the first 6 results in provider order. Fetch each entity until one qualifies. Reject an entity whose P31 is film (`Q11424`), audio book (`Q24856`), television series (`Q5398426`), book series (`Q277759`), television program (`Q7058673`), or video game (`Q7889`). Accept its type as a written work only when P31 includes book (`Q571`), novel (`Q8261`), literary work (`Q7725634`), written work (`Q47461344`), science-fiction book (`Q49084`), or short story (`Q25379`), or it has a P50 author claim. Use its English label, falling back to the search-result label; skip a blank title or a title whose normalized form equals the Hebrew input. Fetch only the first P50 author's English label. This bridge is at most 8 Wikidata requests: one search, six entity reads, and one author read.

   **Series entities (S32).** Also reject an entity whose P31 includes literary or novel series (`Q1667921`), literary trilogy (`Q13593966`), book series (`Q277759`) or series of creative works (`Q7725310`), even when it has a P50 author. Measured on prod 2026-11-21 (`recheck:links` dry run): `משחקי הכס` bridged to Q45875 `A Song of Ice and Fire` and `המצפן הזהוב` to Q129240 `His Dark Materials` (also `Q13593966`); both have `Q1667921` and a P50 author, so they passed and led to `The World of Ice and Fire` and the `His Dark Materials` box. The current links (`A Game of Thrones`, `Northern Lights`) are right.
2. **NLI fallback bridge.** If Wikidata yields no accepted Hardcover work, search NLI SRU with `maximumRecords=25`. When the Simania author is non-empty, first search `alma.title all "<title>" AND alma.creator all "<surname>"`, where `<surname>` is the last whitespace-separated word of the first author (the text before the first comma) with `"` and `\` removed; a plain title search can return hundreds of unrelated archive records, so the right book is not in the first 25 (live case: "הדירה בפריז" returns 316 records by title, 1 with the author). If that search yields no accepted record, or the author is empty, make the plain `alma.title all "<title>"` search. Apply the record rules below to each search's results. For each MARC record, form its Hebrew title from 245 subfields a/b/n/p, creators from 100 and 700 subfields a/d, and original-title candidates in source order from 240 a/n/p, 130 a/n/p, then 765 t. Clean an original candidate by removing a trailing `/ Hebrew`, `/ עברית`, punctuation, and whitespace; take the first non-empty candidate whose normalized value differs from that record's title. Keep only records with Hebrew-title Dice at least `0.78`. Rank by `Hebrew-title Dice * 3 + maximum creator Dice * 2` (the creator term is zero without an author hint), descending, and use the top record's original title and first creator.

   **NLI title page verso (S27).** When parsing an NLI record, add original-title candidates after the 240, 130 and 765 candidates only when the record's 041 field has a subfield `h` whose value is not `heb`. Each additional candidate is a 246 field whose subfield `i` starts with `Title page verso` and whose subfield `a` has a Latin letter and no Hebrew letter. Its title is subfield `a` with trailing spaces, `:`, `/`, `;`, `,` and `.` removed. Subfield `b` of that same 246 supplies `verso author` when it has a Latin letter and no Hebrew letter: use the text before the first `;`, with the same trailing characters removed. The other record rules are unchanged: the candidate must differ from the record's title, and the same Dice thresholds and ranking apply. These rules apply wherever the add-book NLI record rules are used, including the recommendation `nliHebrew` step. Author hints for the NLI Hardcover match are tried in this order: the catalog hint, the chosen record's `verso author`, the Wikidata author bridge, then the NLI creator. Examples: Simania 1530 has `041 $h eng` and `Secrets : Jacqueline Wilson`, producing the bridge `Secrets` with `verso author` `Jacqueline Wilson`; Simania 1529 has `Sleepovers : Jacqueline Wilson ; illustrations, Nick Sharratt.`, producing `Sleepovers` with `Jacqueline Wilson`; Simania 1729 has no 041 `h`, so it produces no candidate; a record with `041 $h heb` also produces no candidate.

   **NLI main title (S28).** In the add-book NLI record rules, a record's Hebrew-title Dice is the maximum of the Dice against the full 245 title (subfields a/b/n/p, as above), 245 subfield `a` alone, and each 246 subfield `a` that has a Hebrew letter. For the latter two forms, remove trailing spaces, `:`, `/`, `;`, `,` and `.` before scoring. The `0.78` threshold, ranking and all other rules are unchanged; the ranking uses this maximum as its title term. This does not change `nliHebrew`, which scores original titles rather than Hebrew titles. Examples: Simania 996119 `טואיצ'י שלי` produces `Jungle - to the edge`; Simania 958612 `מדהימות` produces `Flawless`; Simania 975634 `הולכת רחוק` produces `Wild`.

   **Series prefix (S30).** When the NLI bridge finds no original title for the match title, and the edition's trimmed `series` is non-empty, and the match title starts with that series followed by ` - ` or ` – `, run the NLI bridge once more with the rest of the title, trimmed. Skip this when the rest is empty or matches `/^(כרך|ספר|חלק)\s*\S+$/`. Example: `הגן הכימי - הקמילה` with series `הגן הכימי ` retries with `הקמילה`. `יומני רובורצח - כרך 1` never retries.

3. **Hardcover match.** Author hint for the NLI bridge: NLI creators are Hebrew, which never matches Hardcover contributor names. Before the NLI Hardcover match, use the first available hint in this order: the catalog hint; the chosen record's `verso author`; the Wikidata author bridge; the NLI creator. The catalog hint is the first `original_authors` entry of a work linked to any other edition whose `author` equals this edition's Simania author exactly (non-empty, `work_id` not null; take the most recently resolved one). The Wikidata author bridge is a Hebrew `wbsearchentities` search (`language=he`, `limit=5`) for the Simania author, using the English label of the first human (P31 `Q5`) result whose Hebrew label has Dice at least `0.8` with the author. (Live case: "Paris apartment" has four Hardcover books titled The Paris Apartment; the hint "Lucy Foley", learned from "רשימת המוזמנים" by the same Simania author, picks Lucy Foley's.) For each bridge result, make one Hardcover Book search with `per_page=8`, discard non-numeric IDs, fetch all returned books in one batch, and rank them by `title Dice * 3 + author boost + popularity`, descending, then Hardcover ID ascending. The author boost is exactly `2` when the hint is non-empty and any cached contributor name has Dice greater than `0.45`, otherwise `0`. Popularity is `log10(1 + max(users_read_count, 0)) / 20`. Accept only the first ranked book, and only when its title Dice is at least `0.50`. **Ambiguity:** when the top book got no author boost and another returned book with a different first contributor has the same title Dice, the match is ambiguous: accept nothing (never pick by popularity; live case: NLI gives "Aurora" for "כיבוי אורות" by דיוויד קופ, and Hardcover's top "Aurora" is Kim Stanley Robinson's, while David Koepp's is 559469).

   **Hardcover author retry (S30).** Only in the Wikidata and NLI bridge matches, never in the direct fuzzy fallback: when the match returns no book and the author hint has a Latin letter, make one more match. Its search query is `"<English title> <author hint>"`, and acceptance requires author evidence: a contributor whose Dice with the hint is greater than `0.45`. In this retry only, a book's title Dice is the maximum of the Dice against its full Hardcover title and against the trimmed part before the first `:`. Ranking, the `0.5` title threshold and the tie rule are otherwise unchanged. Examples: Wild gives Hardcover 52808; Night School gives 61420.

   **No box set for a single book (S32).** Unless the match is a box-set match (`boxTitle`), drop books whose title contains `Trilogy`, `Collection`, `Box Set`, `Boxed Set` or `Omnibus` (case-insensitive, whole words), unless the query title itself contains that word. Live case: for `המעון של מיס פרגרין לילדים משונים` the match proposed 609447 `Miss Peregrine's Peculiar Children Boxed Set: 3 Novels`.

   **Companion books (S32).** Drop books whose title contains any of these, unless the query title itself contains it (case-insensitive, whole words): `The Art of`, `The World of`, `Companion`, `Summary`, `Study Guide`, `Reader's Guide`, `Analysis`, `Coloring Book`, `Workbook`, `Untold History`. Live case: 609448 `The Art of Miss Peregrine's Home for Peculiar Children`.

   Both S32 drops apply before ranking, in every pass, and in `verify:fallback`.

   **Hardcover alternative titles (S30).** In the retry search only (extended to every match by **Alternative titles in every match (S31).**), request `results` together with `ids`. A book's title Dice is the maximum over: its full title; the part of the title before the first `:`; each entry in its search document's `alternative_titles`. The author evidence rule and everything else are unchanged. Example: Simania 985271 `הסיפור של מי שברחו ושל מי שנשארו` is bridged by NLI to the Italian `Storia di chi fugge e di chi resta`, and the Wikidata author is `Elena Ferrante`; the search `Storia di chi fugge e di chi resta Elena Ferrante` returns one book, 101133 `Those Who Leave and Those Who Stay`, whose `alternative_titles` contain the Italian title (the English title alone scores below `0.5`). The result is 101133.

   **Alternative titles in every match (S31).** Every Hardcover search requests `ids` and `results` in the same single request. A book's title Dice is the maximum of the Dice against its title, its title before the first `:`, and each of its search document's `alternative_titles`. This extends "**Hardcover alternative titles (S30).**" to all matches, including `verify:fallback`. Ranking, thresholds and the tie rule are unchanged. Measured on prod 2026-11-21: 16301 `האדם המורד` was linked to Hardcover 1851773 `La révolte: La peste, Les Justes, L'homme révolté` (1 reader). The search `L'Homme révolté` returns 488917 `The Rebel` by Albert Camus (407 readers) first; its `alternative_titles` contain `L'Homme révolté`, but its title does not. Example: `L'Homme révolté` by Albert Camus gives 488917.

   **Hebrew author sound (S30).** Only in the NLI bridge match, when no Latin hint was found (no catalog hint, `verso author` or Wikidata author), the hint remains the NLI creator, as before. In addition, a book gets the author boost when `nameSoundScore(<Simania author>, <its contributor names>)` is at least `0.6`. The first match and the S30 retry both use this rule. The retry runs only when the hint has a Latin letter, so it does not run in this case. Examples: Survive gives Alex Morel's 105197; Regeneration gives Pat Barker's 435858.
4. **Direct fuzzy fallback.** If neither bridge produces an accepted work, perform exactly one more Hardcover match using the match title and Simania author as the title and author hint. This path accepts a book only with author evidence: one of its contributor names has Dice greater than `0.45` with the Simania author (live case: "נערה בנוף" by ג'ונתן לת'ם was linked to Hardcover's Hebrew-titled "נערה, מופרעת" by Susanna Kaysen with no author evidence). An acceptance by this direct path is the only path that produces `resolve_status = 'fuzzy'`.

An accepted Wikidata or NLI bridge stores that respective lowercase status; the direct path stores `fuzzy`. Upsert the accepted Hardcover record as the work and set `resolved_at` now. With no accepted result store null `work_id`, `not_found`, and current `resolved_at`. A complete attempt makes at most 22 provider requests: 8 Wikidata, 4 NLI, and at most five two-request Hardcover matches (a bridge match plus retry for Wikidata and NLI, and the fuzzy match), plus at most two catalog reads for the author hint. No LLM call is made. A bridge or resolution-provider failure (network error, timeout, or a non-2xx answer after one retry on 429/5xx) is treated as that path missing and never prevents shelving. If no path is accepted and any provider request failed, keep `pending` with null `resolved_at` instead of storing `not_found`, so a later request retries; `not_found` means every provider answered. Provider requests send a descriptive `User-Agent`.

Before insert, return `409` if the exact edition is already shelved, or if another shelved edition has the same non-null `work_id`. The authoritative duplicate check and append execute together in a `shelf_books` `BEFORE INSERT` trigger whose function is `SECURITY DEFINER` with a fixed safe `search_path`; execution is available only through the trigger, not granted as a client-callable function. First lock the user's `profiles` row with `SELECT ... FOR UPDATE`, using the same lock as the library RPCs and recommendation replacement. Then validate the owned target shelf against `auth.uid()`, lock the referenced `editions` row while reading its `work_id`, and check for the same edition or another edition of that non-null work on any of this user's shelves. Raise `23505` with constraint diagnostic `shelf_books_pkey` for the same edition, or `shelf_books_user_work_key` for the same work. Under the per-user lock, compute `max(position)+1` in the target shelf (0 if empty) and assign it to `NEW.position`, overriding any caller-supplied position. Thus two different books added concurrently both succeed in successive positions; two editions of one work serialize and one conflicts. On every insert, overwrite `added_at` with now, overwrite `finished_at` with now when the target shelf is `read` and with null otherwise, and overwrite `rating` with null; no supplied value survives. After validation, delete the caller's non-dismissed recommendation whose `work_id` equals the inserted edition's non-null `work_id`; this occurs in the same transaction and after the profile lock, so rollback restores the recommendation if insertion fails. Never delete dismissed rows. The trigger runs only on insertion; duplicates caused by later edition resolution remain tolerated. Map only those two named duplicate violations (or the equivalent precheck) to `409`; other `23505` errors are unexpected `500`, not duplicate-book conflicts. Unknown Simania ID or missing/non-owned shelf is `404`; required Simania detail failure is `502`.

### `book-details`

Request `BookDetailsRequest`: `{"simania_id":1234}`, optionally with `simania` as for `add-book`. A `BookDetailsResponse` example is:

```json
{"book":{"simania_id":1234,"work_id":null,"resolve_status":"pending","title":"ספר","author":null,"translator":null,"publisher":null,"series":null,"category":null,"year":null,"pages":null,"description":null,"cover_url":null,"simania_rating":null,"simania_rating_count":null,"shelf_id":null,"shelf_name":null,"shelf_kind":null,"position":null,"added_at":null,"finished_at":null,"rating":null}}
```

Perform the same 30-day detail/rating refresh (for a negative `simania_id`, the English edition, refresh from Hardcover and never call Simania or the resolver; `simania_id` may be negative here). If the edition is still `pending` (an earlier resolution hit a provider failure), also run the resolution procedure above. Never shelve. Fill shelf fields for the caller if shelved, otherwise set them all null. Unknown ID is `404`; Simania failure is `502`.

**Bare editions (browser).** Edge Functions cannot reach Simania, so an edition first stored by `match-by-author` as a candidate has only `simania_id`, `title` and `author` (`details_at` null). Measured 2026-11-05: 10 linked positive editions, one of them on a genre shelf (1024882 הסוד של עוזרת הבית: an English cover on the tile, no cover, rating or description in the card). When the recommendation or genre book card (`openRecommendationCard`) loads a positive `simania_id` and the returned book has `cover_url`, `description` and `simania_rating` all null, the browser fetches the Simania payload itself (`fetchSimaniaPayload`), calls `book-details` again with `{ simania_id, simania }`, and shows that result. If either step fails, it keeps the first result silently. It does this at most once per card open.

### `recommendations`

Request `RecommendationsRequest` is `{}` (unknown fields ignored). Response `RecommendationsResponse`:

```json
{"recommendations":[{"work_id":"78e9c71d-d6f2-4ea4-bcbb-42e4ec9300cf","simania_id":null,"title":"Piranesi","author":"Susanna Clarke","cover_url":"https://...","score":1.75,"because":[1234,5678],"because_titles":["ספר א","ספר ב"],"shared_tags":["fantasy"],"dismissed":false,"generated_at":"2026-10-25T10:00:00Z","english_only":true,"can_add":false}]}
```

Seeds are the caller's books with non-null work and a positive weight: the reader's rating when it is 3-5 (any shelf), 2.5 for an unrated book on `read`, otherwise 0 (not a seed). There is no seed cap. Order seeds by weight descending, then `finished_at desc nulls last`, `added_at desc`, and Simania ID tie-break; this order also orders `because`. Zero seeds calls `replace_recommendations` with an empty array and returns `{"recommendations":[]}` with status `200`.

For each seed inspect only its first 40 `similar_ids`. At zero-based rank `r`, add `weight * (1 - r/40)` to candidate score. Sum across seeds and deduplicate contributing seed IDs. Sort score descending then Hardcover ID ascending. Exclude works of every caller book on every shelf, plus every work in the caller's `dismissed_works` (both kinds).

**Negative seeds (S15).** Every `dismissed_works` row of the caller with `kind = 'not_my_type'` whose work has `similar_ids` is a negative seed with weight `NOT_MY_TYPE_WEIGHT = 5`. For each, at zero-based rank `r` in its first 40 `similar_ids`, subtract `5 * (1 - r/40)` from that candidate's score. Negative seeds never add to `because` or `shared_tags`, and a candidate reached only by negative seeds is not a candidate. After all seeds, drop every candidate whose score is `<= 0`. Example: a candidate at rank 4 (closeness 0.9) of a 5-star seed, a 4-star seed and a not-my-type book scores `0.9*5 + 0.9*4 - 0.9*5 = 3.6`. Null-work shelf books cannot seed and exclude only that edition until resolved.

Fetch missing candidate IDs from Hardcover in batches of at most 50; discard IDs not returned by Hardcover and upsert the rest. Localize candidates in score/Hardcover-ID order. First reuse the linked edition having the lowest `simania_id`, if one exists. Otherwise use this bounded procedure (normalization and Dice are exactly as defined for `add-book`):

1. **Wikidata bridge.** Make one English `wbsearchentities` item search with `limit=10`. Score all returned results as `title Dice * 3 + author-description boost`, where the boost is exactly `2` only when the normalized non-empty author hint is a substring of the normalized search-result description. Sort descending, retaining provider order on a tie, and inspect at most the first 4. Fetch each entity, applying the same written-work/rejected-type filters listed for `add-book`; choose the first with a non-empty Hebrew label. Use the first P50 author's Hebrew label, falling back to its English label. This is at most 6 Wikidata requests: one search, four entity reads, and one author read.
2. **Simania match.** Search once for `"<Hebrew title> <Hebrew author>"` with `limit=6, offset=0`; only when that returns zero results, search the title alone once with the same limit. Do not combine the two result sets. Rank the at-most-6 results as `title Dice * 3 + author Dice * 2` when the bridge supplied an author, otherwise title only; retain provider order on a tie. Accept the top result only when its title Dice is at least `0.45`.

**Simania match rules (S29).** In recommendation step 2 (`matchHebrewBook` in `public/js/simania.js`), hint words are the letter and digit runs of the hint title after removing Hebrew points. When the hint has at least 2 words, the bridge supplied an author, the result's author Dice with that author is at least `0.6`, and every hint word appears among the result title's words, the result's title score is `max(title Dice, 0.85)`; otherwise its title score is the title Dice. The rank score remains `title score * 3 + author Dice * 2`, and the `0.45` acceptance threshold applies to the title score. After rank score, ties are broken in this exact order: (1) the old score, `title Dice * 3 + author Dice * 2`; (2) title Dice against the result title after repeatedly removing trailing `[...]` and `(...)` labels, without ever reducing the title to empty; (3) provider order. When the hint title has exactly one word, search `"<Hebrew title> <Hebrew author>"` and also the title alone, each with `limit=6`, then rank their union with the first search's results first and duplicates by Simania ID dropped; this is still at most 2 Simania searches. Nothing else changes: localization still runs only for English-only cards, and `link-edition` never relinks an edition that already has a `work_id`, so these rules cannot unlink or relink a linked book. The replay test uses `tests/web/fixtures/match-replay.jsonl`, copied from `tasks/sprint-29-match-rules/reference/match-replay.jsonl`: for every case whose `current` pick is in `linked`, the new pick must equal `current`; for every case with empty `linked`, the new pick must equal `current`, except Catching Fire (`hardcover_id` 175780), which must pick Simania 982600. Thus Catching Fire's hint `משחקי הרעב - התלקחות` picks 982600.

3. **NLI fallback.** If the Wikidata bridge is absent or its Simania search is not accepted, make exactly three NLI SRU searches in this order: `uniform_title`, `title`, `all_for_ui`, each with `maximumRecords=25`. Parse fields as in the `add-book` NLI rule and deduplicate records by normalized title plus normalized first creator, keeping the first. Keep only records with at least one Hebrew character in the title. For each, `original score` is the maximum Dice between the Hardcover title and its cleaned 240/130/765 originals; `author score` is the maximum creator Dice, or zero without an author hint. Keep original scores at least `0.72`, rank by `original score * 4 + author score * 2` descending while retaining discovery order on a tie, and use the top record's title and first creator for the Simania match in step 2.

**Wikidata Hebrew title (reverse direction).** In the English `wbsearchentities` search, a result that is an edition item (it has P629 "edition or translation of") stands for its work: follow the first P629 and use that work entity (Wikidata often lists edition items of a book above the work item; live case: "Spin" by Robert Charles Wilson, whose work Q2301398 has the Hebrew label "סחרור"). When the work has P50 authors and the Hardcover author is non-empty, accept the work only if one of the first two P50 authors' English labels has Dice greater than `0.45` with the Hardcover author. Remove a trailing Wikipedia disambiguation in parentheses from the Hebrew label (for example `האזור המת (ספר)` becomes `האזור המת`).

**Hebrew author name.** Every English-only card carries `hebrew_author`: the Hebrew name of the work's first Hardcover author, from (1) the catalog: the Simania `author` of the most recently resolved edition linked to a work whose first `original_authors` entry equals that author (normalized), else (2) Wikidata: an English item search for the author name (`limit=5`), the first result whose label has Dice `1` with the name, that is a human (P31 `Q5`) and has a Hebrew label; else null. Cache per author within one run.

**Step 2 runs in the browser.** The function performs steps 1 and 3 only as far as finding a Hebrew title: the Wikidata Hebrew label and author, or, only when Wikidata yields none, the top NLI record. It returns that as the card's `hebrew_hint` `{"source":"wikidata"|"nli","title":"...","author":"..."|null}` and the card stays English-only. The browser (`localizeRecommendations` in `public/js/recs.js`, at most 3 cards at a time) runs step 2 against Simania, fetches an accepted and verified result's details and rating, and calls `link-edition`. If the title match returns no book, it next runs the omnibus path below. If no title or omnibus book is linked and `hebrew_author` is set, the browser runs the author path: it searches Simania once for the first and last word of `hebrew_author` (`limit: 50`), keeps results with Hebrew titles whose author has Dice at least `0.6` with `hebrew_author` (spelling varies, for example `צ'ארלס` and `צ'רלס`), takes at most 8, and calls `match-by-author`; on a match it fetches that edition's details and rating and calls `link-edition` with `source` equal to the returned `resolve_status` (`fuzzy` is sent as `nli`). A miss or any failure leaves the card English-only. Thus a candidate without a cached edition makes at most 12 server bridge requests (6 Wikidata, 6 NLI) and the browser at most 6 Simania searches plus 2 detail reads. Run at most 5 candidate localizations concurrently, begin no more than the first 40 candidates, and stop scheduling when 20 cards have been accepted or retained as English-only. Every attempted candidate yields a card: if localization is not accepted it uses the English-only fallback, so the ordinary result reaches `min(20, candidate count, 40)` cards. Provider request loops may not exceed these bounds.

**Box-set hints (S31).** When the card's English title has none of the English box words above (`Trilogy`, `Collection`, `Box Set`, `Boxed Set`, `Omnibus`, case-insensitive):
- the browser removes the Hebrew box words (`מארז`, `טרילוגיית`, `טרילוגיה`, `ערכת`, `סט`) from the hint title before searching (`טרילוגיית משחקי הרעב` becomes `משחקי הרעב`);
- `matchHebrewBook` ignores results whose title has a Hebrew box word when the hint title has none.

Wikidata's Hebrew label for `The Hunger Games` is `טרילוגיית משחקי הרעב`, so without this the hint for book 1 names the box set (Simania 980165). Over the 249 S29 replay cases this changes only `The Hunger Games` (`hardcover_id` 88639), whose current pick is the box set 980165.

**NLI alternate hint (S31).** When the hint comes from Wikidata, the function also runs the NLI Hebrew lookup. When it gives a different title (after normalization), the hint carries it as `alternate`. When the browser's step 2 match finds no book for the hint title, it tries `alternate` once, with the same verification, and links with `source` `nli`.
- Live case: Pet Sematary. The Wikidata hint `בית קברות לחיות` finds only a DVD. NLI gives the edition title `בית כברות לחיות`, which is Simania 994102.
- This adds at most 3 NLI requests per English-only candidate: a candidate without a cached edition makes at most 12 server bridge requests (6 Wikidata, 6 NLI), and the browser at most 6 Simania searches plus 2 detail reads. The `alternate` attempt is a second title match and uses at most 2 Simania searches (one-word title), so the 4 searches above become 6. These are the bounds stated above.

**Title-match verification.** A Simania book found by the title match is linked only when verified, in this order: (1) `hebrew_author` is set and the Simania book's author has Dice at least `0.6` with it; (2) the Simania book's author sounds like one of the card's English authors, with `nameSoundScore(simaniaAuthor, englishAuthors) >= 0.8`, where `englishAuthors` is the card's `author` split on `,` and trimmed, with empty parts dropped; or (3) `match-by-author` called with that single book as the only candidate returns it. The sound check runs after the `hebrew_author` Dice check and before `match-by-author`; when it passes, no `match-by-author` call is made, and `resolve_status` is `nli` when `hebrew_hint.source` is `nli`, otherwise `wikidata`. Otherwise the title match counts as a miss (live case: the NLI Hebrew hint for Kim Stanley Robinson's "Aurora" is David Koepp's "כיבוי אורות", whose original title is also "Aurora"). Measured 2026-11-20: Don Quixote (Miguel de Cervantes Saavedra, Roberto González Echevarría) has the hint `דון קישוט` and no `hebrew_author`; Simania 64376, `דון קישוט איש למנשא` by `מיגל דה סרוואנטס`, has sound score `0.86` and was rejected because `match-by-author` needs the server to resolve that edition back to English, while Wikidata and NLI do not know it. Still not verified by the sound check: Aurora (Kim Stanley Robinson), whose hint finds `כיבוי אורות` by David Koepp, and Shades of Grey (Jasper Fforde), whose hint finds `חמישים גוונים של אפור` by E. L. James; their authors do not sound alike. Self-healing and every Hebrew resolution step skip negative (English) edition IDs, and the browser never calls Simania for them.

**Omnibus volumes (S30).** The browser runs this only when the step 2 title match returned no book, not when a book failed verification, and only when the hint has a title. It makes one Simania search for the hint title alone with `limit=6`, then runs `matchOmnibus(hint title, results)` from `public/js/simania.js`. That function splits each result's `subtitle` on ` | ` only when the split has at least 2 non-empty parts. A result counts when one part, after the file's normalization, has `similarity` at least `0.9` with the hint title. It returns the result only when exactly one result counts; otherwise it returns null. The returned book is linked only when its author agrees: `similarity(hebrew_author, author) >= 0.6` when `hebrew_author` is set, otherwise `nameSoundScore(author, English authors) >= 0.8`. Then the existing author guard and `link-edition` run as for any match, with `source` `omnibus`. Example: All Systems Red links to Simania 1026206, `יומני רובורצח - כרך 1`, whose subtitle is `כשל מערכות | התנייה מלאכותית`; `nameSoundScore("מרתה וולס", ["Martha Wells"])` is `1`. Volume 2 (1027891) is not linked by this rule. Over the 249 S29 replay cases, `matchOmnibus` returns a book only for All Systems Red.

**Hebrew points (S25).** Every Hebrew text comparison ignores Hebrew points and cantillation marks: characters U+0591 through U+05C7 are removed, except U+05BE (maqaf), which becomes a space. This happens before `normalize` and `similarity` in the browser (`public/js/simania.js`) and server (`supabase/functions/_shared/utils.ts`), and before the name skeletons of `nameSoundScore` in the browser (`public/js/names.js`) and server (`supabase/functions/_shared/names.ts`). It therefore also applies to `titleMatch`, `mainTitle`, and the candidate rules, on both sides. Measured 2026-11-20: Simania 1027689 is titled `אִינְטֶרְמֶצּוֹ` (Sally Rooney, Intermezzo). `similarity("אינטרמצו", "אִינְטֶרְמֶצּוֹ")` was `0`, because each point became a space; the hint `אינטרמצו` and rule A's candidate both missed it. Stored and displayed titles do not change.

**Self-healing resolution.** Before selecting seeds, the `recommendations` function resolves at most 2 of the caller's shelved editions that have null `work_id` and are `pending` or `not_found` at least 14 days old (most recently added first), with the same procedure, sequentially, and starts no new one after 20 seconds. A failure never fails the request. The library is then loaded, so newly linked books seed and are excluded at once.

**Linking a localized edition** is done by `link-edition` (below), not by this function, after the browser's step 2 accepts a Simania result. Fetch its Simania details and rating when the `editions` row is absent or its `details_at` is at least 30 days old; insert or update all edition display/rating columns and set `details_at` to now. If the row's `work_id` is null (regardless of its current `resolve_status`), set `work_id` to the candidate work, `resolve_status` to `wikidata` or `nli` according to the bridge that supplied the accepted Hebrew title, or to `omnibus` when the omnibus path supplied the result, and `resolved_at` to now. If it already links to that candidate work, retain the link; if it links to a different work, treat this candidate as a localization miss (English-only) and never relink the edition. A required detail-fetch failure for a new row is also a miss. Only after this succeeds may the `simania_id` be written to the caller's recommendation row, which guarantees every non-null recommendation `simania_id` references an edition belonging to its `work_id`. The `recommendations` function itself only sends a non-null `simania_id` to `replace_recommendations` for a positive-ID (Simania) edition already linked to the work; an English edition (negative ID) of the work is never used, and such a work is English-only (null).

Localization misses remain English-only: null Simania ID, title/authors/cover from the work, dismiss allowed, add-to-shelf forbidden. Localized cards use edition display data. `shared_tags` includes only actual candidate Hardcover tags also present on a contributing seed. `because_titles` looks up exact edition titles in `because` order; explanations never invent tags. Call `replace_recommendations` once with the completed candidates to preserve dismissed rows and atomically replace only non-dismissed rows, using one generation timestamp; build the response from its returned rows. Hardcover failure is `502`; individual bridge failure counts as a localization miss.

### Genre recommendation shelves

Computed in the same `recommendations` run, after the ordinary cards, and stored with `replace_genre_recommendations`; the response body does not change.

1. **Genre keys and names (S17).** Genres come from the work's Hardcover `Genre` tags (its first 12; was 8). There is no fixed list of shelves. In `supabase/functions/_shared/genres.ts`:
   - **Normalize** each tag: remove every `"`, `[`, `]` and `\`, replace `-` and `_` with a space, collapse spaces, trim, lower-case. Skip empty results.
   - **Noise** (never a genre): the exact normalized tags `general`, `fiction`, `genre fiction`, `novel`, `novels`, `adult`, `adult fiction`, `literary collections`, `authors`, `audiobook`, `audiobooks`, `ebook`, `ebooks`, `english fiction`, `american fiction`, `british fiction`, `english`, `spanish`, `hebrew`, `french`, `german`, `book club`, `did not finish`, `dnf`, `owned`, `kindle`; and any normalized tag that contains `tbr`, `to read`, `favorite`, `favourite` or `read in`, or that is only digits.
   - **Groups.** A fixed alias table maps known normalized tags to a Hebrew genre name. The Hebrew name is that genre's key and its display name. The table (aliases in normalized form):
     `מדע בדיוני`: science fiction, sci fi, space, aliens, cyberpunk, space opera, hard science fiction · `פנטזיה`: fantasy, epic fantasy, high fantasy, urban fantasy, dark fantasy · `דיסטופיה`: dystopian, dystopia, post apocalyptic, apocalyptic · `מותחנים`: thriller, thrillers, thriller & suspense, suspense, psychological thriller, domestic thriller, legal thriller, espionage, spy · `מתח ובלש`: mystery, crime, murder, detective, mystery & detective, mystery thriller, mystery/thriller, detective and mystery stories, police, police procedural, cozy mystery, crime fiction, noir · `רומנטיקה`: romance, contemporary romance, historical romance · `ספרות יפה`: literary fiction, literary, literature & fiction, literature · `קלאסיקות`: classics · `רומן היסטורי`: historical fiction, historical · `אימה`: horror · `הרפתקאות`: adventure, action & adventure, action · `נוער`: young adult, young adult fiction, teen & young adult, teen, ya · `ריאליזם מאגי`: magical realism · `מלחמה`: war, military fiction · `היסטוריה`: history · `ביוגרפיה וממואר`: biography, biography & autobiography, memoir, autobiography · `קומיקס`: comics, graphic novels, comics & graphic novels · `הומור`: humor, humour, comedy · `עיון`: nonfiction, non fiction · `פילוסופיה`: philosophy · `פסיכולוגיה`: psychology · `מדע`: science, popular science · `ילדים`: children, childrens, juvenile fiction, juvenile nonfiction, middle grade, children's stories, children's literature, picture books · `שירה`: poetry · `סיפורים קצרים`: short stories, short story collections, anthologies · `פוליטיקה`: politics, political science · `מסעות`: travel · `דת ורוחניות`: religion, spirituality, christianity, judaism · `התבגרות`: coming of age · `על-טבעי`: paranormal, supernatural, ghosts, vampires · `מסע בזמן`: time travel · `קומדיה רומנטית`: romantic comedy, rom com · `סאטירה`: satire · `להט"ב`: lgbtq, lgbt, queer, lgbtqia+, lgbtq+ · `ספרות עכשווית`: contemporary, contemporary fiction, realistic fiction · `ספרות נשים`: women's fiction, women · `משפחה`: family, family life, family & relationships · `חברות`: friendship · `ספרות פסיכולוגית`: psychological · `דרמה`: drama · `ספרות ספקולטיבית`: speculative fiction · `פשע אמיתי`: true crime · `מיתולוגיה`: mythology · `אגדות`: fairy tales · `מסות`: essays · `ביקורת ספרות`: literary criticism · `עסקים וכלכלה`: business, economics · `עזרה עצמית`: self help · `פמיניזם`: feminism · `מערבונים`: western, westerns · `סטימפאנק`: steampunk · `LitRPG`: litrpg, gamelit.
   - **Compound tags.** A normalized tag that is not an alias and contains ` & ` or `/` is split on those; when every trimmed part is an alias, the tag gives each part's genre (for example `science fiction & fantasy` gives `מדע בדיוני` and `פנטזיה`). Otherwise the whole tag is handled as below.
   - **Other tags** (not noise, not an alias): the genre key is `en:` + the normalized tag, and its display name is the tag with only the quote/bracket/backslash removal and trimming applied, from the first genre seed (in seed order) whose work carries it, else from the first loaded candidate work that carries it (lowest `hardcover_id`).
   - A work's genres are the distinct keys its tags give, in tag order.
   - Existing rows: Hebrew keys equal the old Hebrew shelf names, so old `genre_recommendations` rows keep matching.
2. **Genre seeds.** The ordinary seeds with their weights, plus every book on the caller's `reading` shelf that is not already a seed, with weight `2.5` (so a genre appears as soon as the reader starts reading in it). Only books with a `work_id`.
3. **Qualifying genres.** For each genre key: `evidence` = sum of the weights of genre seeds whose work has it; `count` = number of such seeds. A genre qualifies when `count >= 2`. Order by evidence descending, then count descending, then display name (Hebrew collation); these are the **automatic** genres. Step 3a decides which genres become shelves.

3a. **Shelf plan (S17).** Read the caller's `profiles.genre_shelf_count` (N, default 10) and `genre_preferences`.
   - Hidden genres never get a shelf.
   - **Pinned** genres come first, by `pin_order`, at most N − 1 of them (so at least one slot stays automatic). A pinned genre is a shelf even when it does not qualify. Its candidates come from **all** genre seeds (not only the seeds that have the genre), filtered to works with that genre, scored as in step 4. It keeps any number of books from 1 to 12; with 0 books it gets no rows.
   - Then the **automatic** genres (step 3 order), skipping hidden and pinned ones; each needs at least 4 books (step 4), and a genre with fewer is dropped so the next one may take its place. Stop when there are N shelves in total.
   - Shelf positions follow this order, from 0.
4. **Books per genre.** Candidates are the first 40 `similar_ids` of that genre's seeds, scored `weight * (1 - rank/40)` summed across those seeds. Keep only candidate works that are in `works` and have that genre (load missing candidate works from Hardcover in batches of 50, at most 200 new works per run in total across all planned genres, highest-scored first). Subtract the negative seeds exactly as in the ordinary scoring (only from candidates that a genre seed reached; drop scores `<= 0`). Exclude works on any of the caller's shelves, every work in the caller's `dismissed_works`, and works already placed on an earlier (higher-ordered) genre shelf. Negative seeds do not change which genres qualify (steps 2-3). Order by score descending, then `hardcover_id` ascending; take up to 12; the minimum is in step 3a. Each book's `because` lists the `simania_id` of each genre seed that contributed to its score (the seed's shelved edition), highest contribution first (ties: lower `simania_id`), at most 10.
5. **Edition.** For each book, `simania_id` is the caller's ordinary recommendation's `simania_id` for that work if any, else the most recently resolved positive-ID edition linked to the work, else null (English-only). No bridge or Simania calls are made for genre shelves.
6. **Failure.** Any failure while computing or storing genre shelves is logged and ignored; it never fails the ordinary recommendations response.

7. **Reader genres (S17).** In the same run, after the shelves, compute every genre key found on the works of the genre seeds or on the loaded candidate works (the first 40 `similar_ids` of every genre seed that are in `works`). For each: `seed_count` = genre seeds whose work has it, `candidate_count` = such candidate works, minus works on the caller's shelves or in `dismissed_works`. Keep keys with `seed_count >= 1` or `candidate_count >= 3`. Order by seed evidence (step 3) descending, then `candidate_count` descending, then display name; keep the first 100; store them with `replace_reader_genres`. A failure here is logged and ignored, like step 6.

**Reading them (browser).** The library screen loads the caller's `genre_recommendations` once when the screen mounts (with each row's work and edition fields) and renders them below the reader's own shelves. Each shelf carries its `genre_key`. After the stored shelves, every pinned genre (from `genre_preferences`) that has no stored rows gets an empty shelf under its `label`. It never re-renders them while mounted: no spinner, no live replacement (except the in-place tile update in "Localizing them" below). New rows written by a background regeneration appear on the next mount or page load. A genre shelf's book opens the book card (Simania edition by `simania_id`; English-only by `book-details` with `simania_id = -hardcover_id`), and the card offers adding it to one of the reader's shelves (`add-book` with `simania_id`, or `hardcover_id` for English-only). The card shows the same reason line as a recommendation card (`buildReasonLine(because_titles, [])`).

**Genre shelves skip shelved works (S31).** When the browser loads genre shelves, it drops rows whose `work_id` is the `work_id` of any edition on the reader's shelves. Live case: a shelved edition was linked to its work after the genre rows were stored, and the same work then showed on a genre shelf. If that read fails, all rows are kept.

**Removing a recommended book (browser, S15).** A book card opened from the Recommendations page or from a genre shelf shows two buttons instead of "לא מעניין אותי": **"הסר"** (`dismiss_work` with `hide`) and **"לא הסגנון שלי"** (`not_my_type`). Both are also shown for English-only cards. While the call runs, both are disabled. On success the card closes, a toast says "הספר הוסר" or "הספר הוסר, ונמליץ פחות על ספרים דומים", and the book leaves the list or shelf at once (the genre shelf drops its tile in place, as after an add; the Recommendations page drops the item). On failure both buttons re-enable and a toast shows the error. Books on the reader's own shelves keep a single remove button, which reads "הסר" since S16 (see "Book card layout (S16)").

**Refresh after removing or restoring (S16).** A successful `dismiss_work` (either kind) or `restore_work` asks for a background regeneration, exactly like a shelf change: `public/js/events.js` gains `RECS_INPUTS_CHANGED = "booknook:recs-inputs-changed"` and `notifyRecsInputsChanged()`, and `main.js` calls `recsRefresh.request()` on it. The existing debounce merges quick consecutive removals into one call. It does not repaint the library shelves (that is `SHELVES_CHANGED`, which stays as is). A failed call asks for nothing.

**Failed regeneration (browser, S20).** The background refresher (`public/js/recs-refresh.js`) remembers whether its last run failed: any error from the `recommendations` call or from localization. It exposes `failed()`, which is true after a failed run and false after a successful one; it starts false. Subscribers are notified of this state change as of a `busy` change. While `failed()` is true and no run is in progress, the Recommendations page (`#recs`) and the shelf settings page (`#genres`) show one status line at the top: "העדכון האחרון של ההמלצות נכשל. ננסה שוב בשינוי הבא." (`role="status"`). The console warning stays.

**Hiding a genre shelf (browser, S17).** Every genre shelf's header (`.shelf-head`) has a small secondary button "הסתר מדף". It calls `set_genre_preference(genre_key, genre, 'hidden')`. While the call runs the button is disabled. On success the shelf section leaves the screen at once, a toast says "המדף הוסתר. אפשר להחזיר אותו בהגדרות מדפי ההמלצות", and `notifyRecsInputsChanged()` is called. On failure the button re-enables and a toast shows the error. A pinned genre's header also shows the label "נעוץ". A pinned shelf with fewer than 4 books (including an empty one) shows the note "אין עדיין מספיק ספרים במדף הזה. דרגו ספרים מהז'אנר הזה כדי לקבל עוד" under its books.

**Recommendation shelf settings page (#genres, S17).** A menu (hamburger) item "הגדרות מדפי המלצות", after "ספרים שהסרתי". The page title is the same text. Loading and error states as on the other screens. The page burger shows on this screen like on the others.
1. **Number of shelves:** a select with 1-20, showing `profiles.genre_shelf_count`. A change calls `set_genre_shelf_count`.
2. **Genre list:** one row per genre in the union of the caller's `reader_genres` (in `position` order) and `genre_preferences` rows whose key is not in `reader_genres` (after them, by `label`). Each row shows the display name, the line "{seed_count} ספרים שלך · {candidate_count} ספרים מתאימים" (only for `reader_genres` rows), the tag "מוצג עכשיו" when that key has `genre_recommendations` rows, and a three-option control: "אוטומטי", "תמיד להציג", "לא להציג", showing the current state (no row = אוטומטי). A choice calls `set_genre_preference(genre_key, label, 'auto' | 'pinned' | 'hidden')`.
3. While the caller has N − 1 pinned genres (N = shelf count), "תמיד להציג" is disabled on the rows that are not pinned, and the note "אפשר לנעוץ עד {N − 1} מדפים, כדי שיישאר מקום לז'אנר חדש" shows above the list. When more than N − 1 are pinned (after lowering N), the same note says only the first N − 1 pins are shown.
4. Every successful change shows a toast "נשמר. המדפים יתעדכנו בעוד רגע" and calls `notifyRecsInputsChanged()`. A failed change restores the previous value and shows the error in a toast.
5. Empty state, when the union is empty: "דרגו כמה ספרים כדי שנמצא ז'אנרים בשבילכם".
6. The new shelves show on the library screen on its next mount, as with any regeneration.

**Book card layout (S16).** The same order for every card (library book, recommendation, genre shelf book), following common book-site cards: identity and ratings first, then what you can do, then the long text.
1. Cover, shelf tag, title, author.
2. Simania rating (`.bk-rating`), then the reader's own stars (`.bk-my-rating`, library books only).
3. `.bk-actions`, directly below the ratings, in this order:
   - the recommendation reason line (`.bk-rec-reason`, recommendation and genre cards only);
   - the shelf selector (`.bk-move`: "העבר למדף" for a library book, the recommendation label for a recommended one), full width up to 320px;
   - the English-only note (`.bk-rec-note`, English-only cards only);
   - a `.bk-buttons` row holding the remove buttons side by side (wrapping on narrow screens, 8px gap): "הסר" alone for a library book; "הסר" and "לא הסגנון שלי" for a recommended book. They are secondary buttons: smaller than today (about 14px text, 8px by 14px padding), same colors.
4. "על הספר" heading and the description (`.bk-desc`).
5. The details list (`.bk-meta`: translator, publisher, year, pages, series), now below the description.

The library book's remove button reads "הסר" (was "הסר מהספרייה"), the same text as on recommendations. The behavior is unchanged.

**Removed books page (`#removed`, S15).** A menu (hamburger) item "ספרים שהסרתי", after "המלצות בשבילי". The page lists the caller's `dismissed_works`, newest first: cover, title, author, and a label "הוסר" or "לא הסגנון שלי". Display data: the work's Hebrew edition when one exists in `editions` (lowest `simania_id` with that `work_id`; its title, author and cover), otherwise the work's `original_title`, first of `original_authors` and `hardcover_cover_url`. Each row has a "החזר" button that calls `restore_work`; on success the row leaves the list and a toast says "הספר יחזור להמלצות בפעם הבאה שהן יתעדכנו". Empty state: "לא הסרת ספרים". Loading and error states as on the other screens. The page burger shows on this screen like on the others.

**Localizing them (browser).** Measured 2026-11-05: 46 of one reader's 60 genre books were English-only, and the recommendations page's localization finds Hebrew editions for most such books (Eleanor Oliphant, Lessons in Chemistry, The Ballad of Songbirds and Snakes, Cell). After the genre shelves render, the library screen localizes English-only genre books in the background: shelf order, then position, at most 12 per mount, 2 at a time. It skips works tried on this device in the last 14 days (a `localStorage` map of work ID to time; a storage failure means nothing is skipped). For each book it calls `genre-hint` and then runs the same procedure as `localizeRecommendations` (title path, then author path with `match-by-author`, then `link-edition`). A linked book's tile is updated in place with the Hebrew title, author and cover (the only in-place change to genre tiles while mounted), and opening it then behaves as a Simania edition. Failures are silent. It stops when the screen unmounts.

### `genre-hint`

Request `GenreHintRequest`: `{"work_id":"..."}`. Response `GenreHintResponse`: `{"work_id":"...","hebrew_hint":{"title":"...","author":"..."}|null,"hebrew_author":"..."|null}`, computed exactly as the `recommendations` function computes `hebrew_hint` and `hebrew_author` for an English-only card (the same `defaultHebrewHint` and `hebrewAuthorFor`, positive-ID editions only). JWT required; the caller must have a `genre_recommendations` row for `work_id` (`404`); bad body `400`; a provider failure gives nulls, not an error. Nothing is written.

### Catalog fallback for English-only books (`hebrew-candidates`)

Measured 2026-11-07, both readers: of 55 English-only books, 23 had a Hebrew edition on Simania that the title and author paths missed. A deterministic probe recovered 21 of them, with no wrong links. It searched NLI by the author's Latin authority name and then found the Hebrew title on Simania. Expected links (the `verify:fallback` cases):

| English (Hardcover) | Simania | rule |
|---|---|---|
| Before We Were Strangers | 990620 | A |
| Better Than the Movies | 1008203 | A |
| From Lukov with Love | 1005485 | A |
| The Cheat Sheet (Sarah Adams) | 1010339 | A |
| To Hate Adam Connor | 989571 | A (NLI spells "Conor") |
| Little Bear | 3659 | A |
| Behind Closed Doors (B.A. Paris) | 986532 | A |
| Hidden Pictures | 1007788 | A |
| Lexicon (Max Barry) | 973447 | A |
| The Invisible Life of Addie LaRue | 1005442 | A (Simania author "ו.א. שוואב") |
| The Kind Worth Killing | 984972 | A |
| The Last Thing He Told Me | 1004977 | A |
| The Overnight Guest | 1024242 | A |
| The Woman in Cabin 10 | 990033 | A |
| The Women (Kristin Hannah) | 1011037 | A |
| Snow Crash | 977074 | B |
| Anxious People | 1003668 | D (NLI original "Folk med Ångest") |
| A Canticle for Leibowitz | 42259 or 1025481 | E (Simania title "הימנון ללייבוביץ [מהדורת 2003]") |
| Girl in Landscape | 34027 | G |
| Small Island (Andrea Levy) | 97143 | G |
| Never Lie (Freida McFadden) | 1029088 | G |
| Don Quixote (Miguel de Cervantes Saavedra) | 183461 | F (Simania year 0; S19) |

Must not link: Aurora (Kim Stanley Robinson) to 1013521 כיבוי אורות (David Koepp); Behind Closed Doors to 220768 (an Israeli book by another author); Pretty Girls (Karin Slaughter) to 41212 הנקודה העיוורת (it is Blindsighted); The Only One Left (Riley Sager) to 1028558 רכבת הנקמה (it is With a Vengeance); The Lathe of Heaven and Watchers to anything by rule G; Regeneration (Pat Barker) to 844 דרך הרפאים (it is The Ghost Road). The Folk of the Faraway Tree (Enid Blyton) to 103718 הרפתקאות ג'ימי ילד הקרקס; North Woods (Daniel Mason) to 223491 ארץ רחוקה (S18; NLI has no Hebrew edition of either, checked 2026-11-19). Blue Exorcist (Kazue Kato) to 2970 מגרש השדים (The Exorcist; S21). Fiesta a medianoche (Pedro Mañas, David Sierra Listón) to 60087 בחצות הלילה by ג'קלין ווילסטון (S22). The two wrong links were made in production on 2026-11-07 by the first rule G (it matched "Julia"/"Atlanta" and "Took"/"Kit") and were undone with `unlink:fallback`. Rule G v2 (S13) was probed over all 61 English-only books on 2026-11-07 and made 20 links, all correct (`tasks/sprint-13-fallback-g/`). Known misses, left English-only: Grass (20895, no Simania description) and Stories of Your Life and Others (42098, no character names). The working probes are in `tasks/sprint-12-fallback/reference/`, a read-only reference that the implementation follows; where they differ from this section, this section wins.

**It is a fallback only.** It runs for a card only after the title path and the author path (`match-by-author`) have both missed, and only while the card is still English-only. It never touches a card that has a `simania_id`. It links only through `link-edition`, so an edition already linked to a different work is never relinked (`409`, a miss).

**Shared helpers (pure, deterministic).**
- `mainTitle(t)`: remove `[...]` tags, cut at the first `:` or `(`, collapse spaces, trim.
- `titleMatch(a, b)`: `similarity(mainTitle(a), mainTitle(b)) >= 0.8`, or character-bigram Dice of the two `normalize`d main titles `>= 0.85`.
- `authorAgrees(hebrewAuthor, simaniaAuthor, englishAuthor)`: `similarity(hebrewAuthor, simaniaAuthor) >= 0.5`, or `nameSoundScore(simaniaAuthor, [englishAuthor]) >= 0.7`, or (when `hebrewAuthor` is non-empty) the last word of the two `normalize`d Hebrew names is equal.
- `soundAgrees(simaniaAuthor, englishAuthor)`: `nameSoundScore(simaniaAuthor, [englishAuthor]) >= 0.7`.
- `nameHits(englishNames, hebrewDescription)`: the English names for which some Hebrew description token has `nameSoundScore(token, [name]) >= 0.85`. Tokenizing first turns `׳` (U+05F3), `’` and a backtick into `'`, and `״` (U+05F4) into `"`. A token is a run of Hebrew letters and those two marks; marks at its ends are trimmed, and it needs at least 3 Hebrew letters. Each token is also tried without one leading `ו ה ב ל מ ש כ` when longer than 3. Live case: "טרישה ואית׳ן" must hit both Tricia and Ethan.
- Edge Functions cannot import `public/js` (deploy bundles only `supabase/functions`), so there are two copies:
  - Server: `supabase/functions/_shared/names.ts` (`nameSoundScore`, moved from `scripts/lib/names.ts`, which now re-exports it) and `_shared/fallback-match.ts` (`mainTitle`, `titleMatch`).
  - Browser: `public/js/names.js` and `public/js/hebrew-fallback.js` (all five helpers).
  - A parity test (`tests/functions/fallback-parity.test.ts`) runs both copies on the same fixed cases and requires identical results.

**Name sound fixes (S21).** `nameSoundScore` (the same algorithm in `public/js/names.js` and `supabase/functions/_shared/names.ts`) must score these pairs of the same person at least 0.6: ג'ו היל / Joe Hill; ג'וג'ו מויס / Jojo Moyes; רוברט מ. פירסיג / Robert M. Pirsig; רואלד דאל / Roald Dahl; אלדוס האקסלי / Aldous Huxley; פאולו קואלו / Paulo Coelho; אן פאצ'ט / Ann Patchett; צ'אק פלאניוק / Chuck Palahniuk; ג'ורג' אורוול / George Orwell; הרוקי מורקמי / Haruki Murakami; אליסון נואל / Alyson Noël; ניקולה יון / Nicola Yoon. It must score these pairs of different people at most 0.3: וויליאם פיטר בלאטי / Kazue Kato; מילן קונדרה / Louis Sachar; ד'ר ד.אשבל / David Mitchell; ליאת רוטנר / Fanny Blake; אריקה לאונרד ג'יימס / Jasper Fforde; אשכר ארבליך-בריפמן / Boualem Sansal; ג'קלין ווילסטון / Pedro Mañas. All the pairs already in the name-sound tests keep their expected side. Measured 2026-11-19: ג'ו היל / Joe Hill scored 0.00, the same as וויליאם פיטר בלאטי / Kazue Kato.

**`hebrew-candidates` (Edge Function, server side; NLI, Wikidata and Hardcover answer from Supabase).**
- Request `HebrewCandidatesRequest` `{"work_id":"..."}`. Response `HebrewCandidatesResponse` `{"work_id":"...","candidates":[{"title":"...","author":"..."|null,"rule":"A"|"B"|"C"|"D"|"E"|"F"|"G"}],"english_names":["..."],"original_year":1987|null}`. `original_year` (S18) is the work's Hardcover `release_year`, taken from the same single Hardcover request that gives the description; null when Hardcover has none or the request fails. Both the handler and the operator scripts compute it with the shared `originalYearOf(book)` in `supabase/functions/_shared/hebrew-candidates.ts` (S19): the book's `release_year` when it is a positive integer, otherwise null.
- JWT is required. The caller must have a non-dismissed recommendation or a `genre_recommendations` row for `work_id` (`404`). Bad body `400`. A provider failure leaves that rule's candidates out, not an error. Nothing is written.
- From the work: English title `t` = `original_title`, English author `a` = `original_authors[0]`.
- NLI records: one SRU query `alma.creator all "<last>, <first>"`, built from `a` (drop a final `Jr`/`Jr.`; last word, comma, first word), `maximumRecords=100`, read page by page with `startRecord` 1, 101 and 201 (S18), stopping after a page with fewer than 100 records, so at most 300 records. Measured 2026-11-19: NLI has 110 records for Enid Blyton, 131 for Stephen King and 176 for Agatha Christie, so one page missed their later records. Also one query `alma.creator all "<last>, <first>" AND alma.uniform_title all "<mainTitle(t)>"`. Keep records whose 245 title has a Hebrew letter. Hebrew title = 245 before ` / `, without `[...]`, trailing punctuation trimmed. Hebrew author = 100 `a` without dates or a role word, reordered from `Last, First` to `First Last`. Original = 240 without a trailing `. Hebrew`.
- Candidates, in this order, without duplicates, at most 8:
  - **A.** Records whose original passes `titleMatch(original, t)`.
  - **B.** Records with no original whose Hebrew title has `nameSoundScore(hebrewTitle, [mainTitle(t)]) >= 0.7` (S23; was 0.85). Measured 2026-11-20: 85002 שאטר איילנד scored 0.73 against Shutter Island and fell to rule G, so it was never linked. The browser still requires `titleMatch` and `authorAgrees` on the Simania result.
  - **D.** Records whose original passes `titleMatch` with one of the work's original-language titles on Wikidata: the item found by `wbsearchentities` for `mainTitle(t)` whose `P50` author's English label agrees with `a` (`similarity >= 0.5` or the same last word); its `P1476` values and its non-Hebrew labels.
  - **C.** Records whose Hebrew title passes `titleMatch` with `wikidataHebrew(t, a)`.
  - **E.** `nliHebrew(t, a)`'s title, with `author` null.
  - **F.** `wikidataHebrew(t, a)`'s title, with `author` null, when C found no record.
  - **G.** Records with no original (not already listed). `english_names` holds the capitalized words of length ≥ 5 (S18; was 3) in the Hardcover `description` that are not the first word of a sentence. It leaves out a fixed stop list, the words of `t`, and the words of `a`. The stop list covers articles, pronouns, months and number words, common English words (at least the list in `tasks/sprint-13-fallback-g/reference-rule-g.probe.ts`, `COMMON`, for example "Took", "Hope", "End", "Provided", "Called", "Choice"), demonyms ("American", "British", "Western") and review sources ("New York Times", "Newsday", "Washington Post", "Amazon", "Kirkus", "Goodreads", "Publishers Weekly"). Compare case-insensitively.
  - Measured 2026-11-19 (S18): short names sound-match ordinary Hebrew words. The Folk of the Faraway Tree (Enid Blyton) hit 103718 הרפתקאות ג'ימי ילד הקרקס only through "Beth" and "Wood". North Woods (Daniel Mason) hit 223491 ארץ רחוקה (his 2008 novel A Far Country) through "Poe", "Thoreau", "Choice" and "Chicago", which are authors and a city named in the blurb. The first is stopped by the length rule; the second by the year guard below.
  - NLI 100 author: only subfield `a` is used, and any word with a Latin letter is dropped. Live case: one record came back as "ריילי heb PreferredLanguageHeading סאגר".
- Bounds: at most 4 NLI (3 creator pages and the uniform-title query), 4 Wikidata and 1 Hardcover requests per call, within 25 seconds. A Wikidata `429` is retried once after 2 seconds; the retry does not count toward the 4. Measured: a bulk run lost Anxious People (rule D) to Wikidata `429`.

**Author guard (browser, S21).** Before any `link-edition` call from `localizeRecommendations`, from the title path, the author path or the fallback, the browser checks `authorGuardRejects(simaniaAuthor, englishAuthors, hebrewAuthor)` from `public/js/hebrew-fallback.js`:
- `englishAuthors` is the card's English author split on commas;
- `hebrewAuthor` is the card's `hebrew_author` or empty.

It rejects, and the card stays English-only with no link and no error, exactly when all of these hold:
- `simaniaAuthor` contains a Hebrew letter;
- `nameSoundScore(simaniaAuthor, englishAuthors) < 0.3`;
- not (`hebrewAuthor` is non-empty and `similarity(hebrewAuthor, simaniaAuthor) >= 0.5`).

An empty or Latin-script Simania author is never rejected. Measured 2026-11-19: Blue Exorcist (Kazue Kato) was linked by the title path to 2970 מגרש השדים by וויליאם פיטר בלאטי (The Exorcist).

**Guard precision (S22).** `authorGuardRejects` also never rejects when:
- **No English author:** `englishAuthors` has no non-empty entry.
- **Hebrew-original book:** every non-empty English author contains a Hebrew letter. This covers Hebrew-original works whose `original_authors` are Hebrew.

The audit's row filter uses the same rules. `nameSoundScore` must also score these same-person pairs at least 0.6:
- אלוין ברוקס וייט / E.B. White. An initial matches a full first or middle name that starts with that sound; "E.B." stands for Elwyn Brooks.
- יו האווי / Hugh Howey. A silent "gh" counts as nothing.
- ג'יי. קיי. רולינג / J.K. Rowling.

It must score ג'קלין ווילסטון / David Sierra Listón at most 0.3 (Jacqueline Wilson; a wrong link to Fiesta a medianoche). All S21 pairs and existing name-sound tests keep their side. Measured 2026-11-20: of 499 linked editions, the S21 guard flagged 19. 14 were wrong links and 5 were correct: Charlotte's Web, Wool, טווס בחדר מדרגות, Zen and the Art of Motorcycle Maintenance (no English author), How to Change Your Mind (no English author).

**Resolver author guard (S23).** `ensureResolved` in `supabase/functions/_shared/catalog.ts` checks every Hardcover match from the wikidata, nli and fuzzy paths with `authorGuardRejects(edition.author, matchAuthors, "")`. `matchAuthors` are the match's contributor names. The server copy of the guard is `authorGuardRejects` in `supabase/functions/_shared/fallback-match.ts`, the same rules as the browser copy, including S22's when present. A rejected match counts as no match for that path, and the resolver tries the next path. A rejection is not a provider failure, so it never makes the status `pending`. Measured 2026-11-20: after 15 wrong links were unlinked, the refresh re-made 9 of them through this resolver. One was 972426 דברי by לורי האלס אנדרסון (Speak) linked to Dream of the Red Chamber (Cao Xueqin), from a Wikidata lookup by Hebrew title only.

**Browser decision (`localizeFallback` in `public/js/recs.js`).** It runs after the existing paths miss, for every English-only card, including ones with no `hebrew_hint` or `hebrew_author`.
1. Call `hebrew-candidates`.
2. For rules A-D (and C), in order, for each candidate: `searchBooks` for `"<mainTitle(title)> <author>"`, then for `mainTitle(title)` alone (limit 10). Take the first positive-ID result with `titleMatch(candidate.title, result.title)` and `authorAgrees(candidate.author ?? "", result.author, englishAuthor)`. The first rule tier that yields a result decides. If that tier yields two different Simania IDs, stop with no link.
3. Rules E and F: the same search, but the result must pass `titleMatch` and `soundAgrees`.
3a. **Year guard (S18).** For rules E, F and G only: when `original_year` is a number, skip every Simania result or found edition whose `year` is a positive number below `original_year − 1` (S19: Simania uses 0 for an unknown year, so 0, negative and missing years never trigger the guard; measured 2026-11-19: 183461 דון קישוט has year 0). A translation cannot come out before its original; the one-year margin allows for date differences. For rule G, a skipped edition is not a found edition: it gives no hits, does not count against another edition, and its details are not read. Rules A-D are unchanged, because their title evidence is strong and an old reissue year on Hardcover must not drop them.
4. Rule G: find each G candidate on Simania as in step 2 (at most 6), and read the details `description` of each found edition.
   - A hit is **distinctive** when that English name does not also hit another found edition's description.
   - The edition with the most distinctive hits wins only if it has at least 2 distinctive hits and every other found edition has no hits at all (not even shared ones). Same-author series books share characters, so any hit on another edition means no link.
   - Live cases:
     - Pretty Girls: Julia hits two Slaughter books, so only Atlanta is distinctive → no link.
     - The Lathe of Heaven: Orr and Haber hit three Le Guin books → no link.
     - Never Lie: Tricia and Ethan → link 1029088.
     - Regeneration (Pat Barker): 844 דרך הרפאים (The Ghost Road, book 3) has Kemp and Sunday distinctive, but 145387 התחדשות and 1059 עולם אחר also have hits (Siegfried, Sassoon, Peter) → no link. Measured 2026-11-07 in the S13 population review, before any apply.
5. On a decision, fetch the payload and call `link-edition` with `source: "nli_author"`. Any miss, tie, failure or `409` leaves the card English-only.
- Bounds per card: at most 12 Simania searches and 6 detail reads.

**Population review.** `npm run verify:fallback -- --population` runs the fallback decision read-only for every English-only recommendation and genre row of every reader (`openProdDb({ readOnly: true })`). It prints one JSON line per book (`title`, `author`, readers, decided `simania_id`, Hebrew title, `rule`, and for rule G the distinctive and all hits of each edition), then the totals. It writes nothing. In this review and in every mode below, a Wikidata `429` that remains after the function's own retry makes the script wait 30 seconds and run that book again, up to 3 times (S18). A book that still fails is printed with `errors`, as before. In every mode the script passes `original_year` (from `originalYearOf` on the Hardcover book it already loads) to `localizeFallback`, exactly as the browser gets it from `hebrew-candidates`, so the year guard runs in the review (S19; before, it was missing and the review could not see the guard). The operator reviews this list before any `refresh:all -- --apply`.

**No-regression tools (S18).**
- `npm run verify:fallback -- --replay-linked` runs the same read-only fallback decision for every work that has a linked positive-ID edition and is on any reader's shelf, recommendation or genre row. Each work is treated as if it were English-only; nothing is written. It prints one JSON line per work: `hardcover_id`, `title`, `author`, the current linked `simania_id` values and their `resolve_status`, the decided `simania_id`, `rule`, rule G evidence and `errors`. Then it prints the totals: works, decided, `same_as_linked`, `different_from_linked`, none, and errors.
- `npm run verify:fallback -- --compare <before.jsonl> <after.jsonl>` reads two outputs of the same mode (lines that are not JSON objects are ignored, for example tool install messages), matched by `hardcover_id` for replay output and by `title` + `author` for population output. It prints every book whose decided `simania_id` or `rule` changed, as one JSON line `{ key, before, after }`. Books with `errors` in either file are listed separately as `unverified`. Then it prints the counts. It exits `1` when a book changed from deciding an ID that equals its current link (replay) or that the operator marked correct to deciding something else or nothing. Otherwise it exits `0`. The marks come from an optional `--keep <file>`: one key per line.
- Operator rule for S18 and later fallback changes: run `--population` and `--replay-linked` on the code before the change and on the code after it, then `--compare` each pair. No `refresh:all -- --apply` until every changed book is reviewed, and every book that was decided correctly before is still decided the same way.

**Hardcover budget (S27).** Before any other work, `refresh:all` and `verify:fallback -- --population` or `verify:fallback -- --replay-linked` make one Hardcover GraphQL request `{ me { id } }` with the operator's `HARDCOVER_API_KEY`. On any response status, including `429`, they read the `x-ratelimit-daily-remaining` response header and print `{ "hardcover_daily_remaining": n }`, where the value is `null` if the key, header or request is missing. When `n` is a number below `--min-hardcover <n>` (default `1500`), they print a one-line reason and exit `4` without opening the database; `--force-hardcover` skips only this stop. `--compare` makes no request. The key is never printed.

**`resolve_status` gains `nli_author`** (linked by this fallback). `link-edition` accepts `source` `nli_author`. **`npm run unlink:fallback`** (`scripts/unlink-fallback.ts`, off-cloud, dry-run by default) lists every edition with `resolve_status = 'nli_author'`: `simania_id`, Hebrew title, work `hardcover_id` and English title. With `--apply` it sets `work_id = null`, `resolve_status = 'pending'` and `resolved_at = null`, and nulls `simania_id` on the recommendation and genre rows that point to those editions, in one transaction. With `--apply --simania <id>` it does the same for one edition.

**`npm run audit:authors`** (`scripts/audit-authors.ts`, read-only, S21) lists every linked positive-ID edition that is on any reader's shelf, recommendation or genre row and that `authorGuardRejects(edition.author, work.original_authors, "")` would reject. One JSON line per edition: `simania_id`, Hebrew title and author, `resolve_status`, work `hardcover_id`, English title and authors, and the best `nameSoundScore`. Then the totals. It writes nothing. The operator reviews this list. Repairs need the operator's OK, one by one: `npm run unlink:fallback -- --apply --simania <id> --any-status` unlinks one edition whatever its `resolve_status` (S21; without `--any-status`, `--simania` still accepts only `nli_author`). With `--all` it checks every linked positive-ID edition, not only those used by a reader (S22). The output format is the same, and `totals` gains `"scope": "all"` or `"scope": "used"`.

### `match-by-author`

Request `MatchByAuthorRequest`: `{"work_id":"...","candidates":[{"simania_id":97171,"title":"סחרור","author":"רוברט צ'רלס וילסון"}]}`; at most 8 candidates (`400` otherwise). Response `MatchByAuthorResponse`: `{"simania_id":97171,"resolve_status":"wikidata"}` or `{"simania_id":null,"resolve_status":null}`.

The caller must have a non-dismissed recommendation or a `genre_recommendations` row for `work_id` (`404`). Read the work's `hardcover_id`. For each candidate in order: if an `editions` row exists and is linked, compare its work; otherwise insert a minimal `pending` edition row (`simania_id`, `title`, `author`; other display fields null, `details_at` null) when absent and resolve it with the resolution procedure above. Accept the first candidate whose linked work has exactly the recommended `hardcover_id`. Resolve sequentially and start no new candidate after 25 seconds. Candidates that resolve to other works stay linked to those works (useful catalog data). Never link an edition to a work its own resolution did not produce. Provider failures leave that candidate `pending` and are not an error.

### Operator scripts: catalog audit and link repair (off-cloud)

Two scripts run from an operator machine, never from an Edge Function or the browser. They read production with the database password from `BOOKNOOK_ENV_FILE` (`TORIMITOR_DB_PASSWORD`; host `aws-1-eu-central-1.pooler.supabase.com:5432`, user `postgres.zheosjpootcwvuazwjzh`, database `postgres`) and `HARDCOVER_API_KEY` from the same file. Secrets are never printed. Off-cloud they may call Simania directly, including the public book page `https://simania.co.il/bookdetails.php?item_id=<id>`, which Edge Functions cannot reach (Cloudflare `403`) and browsers cannot read (no CORS).

**Original title from the Simania page.** `pageOriginalTitle(html)`: the Latin original title Simania shows for a translated edition, or null. Sources in order: the JSON-LD `alternativeHeadline` value; else the first element rendered with `"style":{"direction":"ltr"}` right after the Hebrew title (in the page's escaped React payload, `\"direction\":\"ltr\"},\"children\":\"<text>\"`). Unescape, trim, then cut a trailing ` + <companion title>` part. Return null when the value has no Latin letter or contains Hebrew letters. Hebrew originals (no such element) return null.

`pageOriginal(html)`: `{ title, author } | null` from the same value. After the companion cut: when the value contains ` / `, the part after the last ` / ` is the `author` (trimmed; null unless it has a Latin letter and no Hebrew or digit) and the part before it is the title; else `author` is null. Then cut a trailing series parenthetical `(… #<digits>)` (for example `Fifty Shades of Grey (Fifty Shades, #1)` → `Fifty Shades of Grey`) and trim. `pageOriginalTitle(html)` is `pageOriginal(html)?.title ?? null`. Measured 2026-11-05: `Educated / Tara Westover` (997264), `The Midnight Library / Matt Haig` (1002037).

**Name sound score.** `nameSoundScore(hebrewName, latinNames)`: deterministic 0..1 score that a Hebrew-script name and a Latin-script name are the same person. Build a consonant skeleton for each: Hebrew letters map to Latin consonants (`ב`→b, `ג`→g, `ג'`→j, `ד`→d, `ו`→v, `ז`→z, `ח`→h, `ט`→t, `כ ך ק`→k, `ל`→l, `מ ם`→m, `נ ן`→n, `ס ש`→s, `צ ץ`→s, `צ'`→ch, `פ ף`→p, `ר`→r, `ת`→t; `א ה ע י` and geresh drop); Latin names are lower-cased with `ph`→f, `th`→t, `ch`→k, `sh`→s, `ck`→k, `c` before `e i y`→s, vowels and `y` dropped. Then both skeletons map letters to sound classes (`b p f v w`→p, `g k c q x j`→k, `d t`→t, `s z`→s, `h`, `l`, `m`, `n`, `r` keep their own class), collapse repeated letters, and compare with letter-bigram Dice. The score is the maximum over `latinNames`. Measured on production's 138 linked editions: at `0.5`, 112 true pairs pass and 5 of 136 wrong pairs pass, so the score is only ever used together with an exact title match, never alone.

**Link proposal** for one positive edition (the same rules whether it is unlinked or a suspected wrong link): read `pageOriginal`; none → no proposal (`reason: "no_original_title"`). English author: the page `author` when present (Wikidata is then not called), else `wikidataEnglishAuthor(edition.author)`. Search Hardcover with the original title and keep candidates whose title score is at least `0.9`; the title score is the higher of the Dice with the full candidate title and with its main title (the part before the first `: `, so `Educated: A Memoir` scores as `Educated`). With an English author, accept the single best candidate whose authors match it (`similarity > 0.45`). Without one, accept a candidate only if exactly one candidate has `nameSoundScore(edition.author, its authors) >= 0.5`; zero or several → no proposal (`reason: "no_author_match"` / `"ambiguous"`). Provider failure → no proposal (`reason: "provider_error"`).

**`npm run audit:catalog`** (`scripts/audit-catalog.ts`): read-only (the session sets `default_transaction_read_only = on`). Prints three sections, and with `--json` one JSON object `{english_only_with_hebrew, author_mismatches, unlinked}`:
1. `english_only_with_hebrew`: non-dismissed recommendations with null `simania_id` for which the browser author path (`searchByAuthor` + `matchHebrewBook` + `verifyTitleMatch` from `public/js`, as in the localization gate) finds a Hebrew Simania edition: user display name, `hardcover_id`, English title, proposed `simania_id` and Hebrew title.
2. `author_mismatches`: linked positive editions whose `author` does not match the work. An edition is cleared (not flagged) by the first check that holds, in this order: (a) `similarity(edition.author, a)` > `0.45` for some `a` in `work.original_authors` (same-script names, for example `Lena Dunham`, or a Hebrew original whose work lists the Hebrew name); (b) `nameSoundScore(edition.author, work.original_authors) >= 0.5`; (c) `wikidataEnglishAuthor(edition.author)` matches one of `work.original_authors` (`similarity > 0.45`); (d) the link proposal for the edition is `ok` with the same `hardcover_id` as the current work (independent confirmation from the Simania page). Otherwise it is flagged, with its link proposal attached (`proposal`, as in `unlinked`). Prints `simania_id`, Hebrew title and author, `hardcover_id`, English title and authors, and the proposal or its reason. `findAuthorMismatches(editions, deps)` is the exported function that computes this section, used by `repair:links` too.
3. `unlinked`: shelved positive editions with null `work_id`, each with its link proposal or reason.
Exit `0` after printing (findings are a report, not a failure); exit `2` on a database or provider failure that prevented a section.

**`npm run report:omnibus`** (`scripts/report-omnibus.ts`, S30): read-only. It prints one JSON line per edition with `resolve_status` `omnibus`, ordered by `resolved_at`. Each line has `simania_id`, `title`, `author`, `series`, `work_id`, `hardcover_id`, `original_title`, `original_authors` and `resolved_at` (edition columns plus the linked work's columns). Then it prints `{ "total": n }`. The operator reviews every line after each refresh.

**`npm run repair:links`** (`scripts/repair-links.ts`): computes the `unlinked` proposals; dry-run by default (prints what it would change). With `--apply`, for each proposal in one transaction per edition: upsert the Hardcover work exactly as the resolver does, then set `work_id`, `resolve_status = 'original_title'`, `resolved_at = now()` only where `work_id` is still null. It never changes recommendations or shelves.

Relinks: it also plans a relink for each `author_mismatches` entry whose proposal is `ok` and whose proposed `hardcover_id` differs from the current work's (dry-run prints `relink`, `simania_id`, Hebrew title, from `hardcover_id`/title, to `hardcover_id`/title, evidence). With `--apply`, in one transaction per edition: upsert the proposed work as above, then set `work_id`, `resolve_status = 'original_title'`, `resolved_at = now()` only where `work_id` still equals the old work's id (0 rows → `skipped`). Mismatches without such a proposal are only reported. The old work row is left in place. Recommendations are not edited: the next recommendations run already drops works that are on the reader's shelves.

`resolve_status` gains the value `original_title` (linked by the repair script from Simania's original title).

**`npm run refresh:all`** (`scripts/refresh-all.ts`): after a deploy, brings every reader's recommendations and genre shelves up to date before anyone opens the app, doing exactly what that reader's browser would do.
- **Credentials.** The service-role and anon keys come at runtime from the Supabase CLI already signed in on the operator machine (`npx supabase projects api-keys --project-ref zheosjpootcwvuazwjzh -o json`). They are held in memory only, never printed, logged or written. The URL is `https://zheosjpootcwvuazwjzh.supabase.co`.
- **Acting as a reader.** For each reader (`auth.admin.listUsers`, joined to `profiles`), get a session the way an emailed magic link would: `auth.admin.generateLink({ type: "magiclink", email })`, which sends no email, then `auth.verifyOtp({ type: "magiclink", token_hash })` with the anon key. Use that access token for the function calls below. It is never printed. Readers are processed sequentially.
- **Steps per reader, in order:**
  1. `POST recommendations` (the normal full run, including genre shelves).
  2. `localizeRecommendations` (from `public/js/recs.js`) over that response's English-only cards, concurrency `--concurrency N`.
  3. Process the English-only `genre_recommendations` rows `--concurrency N` at a time, each still running `genre-hint` and then `localizeRecommendations` on that book. There is no 12-book cap and no device memory.
  4. For each positive edition on that reader's recommendation, genre or shelf rows with `details_at` null, and each of the reader's positive editions whose `resolve_status` is `pending` (S26; `book-details` already runs the resolution for a pending edition): `fetchSimaniaPayload` from this machine, then `book-details { simania_id, simania }`.
  5. Print per reader: English-only cards before and after, genre English-only before and after, books linked, and editions filled.
- **Speed (S24).**
  - **Concurrency.** `--concurrency N` is an integer from 1 to 8; the default is 4. Any other value exits `2` before any network call. Results never depend on N. The per-reader totals and the set of `link-edition` calls are the same as with N = 1, except where two books of one reader link the same Simania edition (then which one gets the `409` can depend on timing).
  - **Simania.** The run has one Simania throttle, shared by every reader and every concurrent book: at least 1,000 ms between the starts of any two Simania requests. This replaces the per-reader throttle. Step 4 (editions without details) goes through the same throttle.
  - **Skip cache.** `--skip-cache <file>` is optional. Without it nothing is cached and the run behaves as before.
    - The file is JSON: `{ "code": "<hash>", "entries": { "<work_id>": "<ISO time checked>" } }`.
    - `code` is the SHA-256 hex digest of the contents of every `.js` file under `public/js` and every `.ts` file under `supabase/functions`, sorted by path, each path followed by its contents.
    - Before step 2, an English-only card or genre row is skipped if its `work_id` is in `entries`, the file's `code` equals the current hash, and the time is less than 7 days old. A skipped genre row makes no `genre-hint` call.
    - A book is added with the current time only when it was checked, made no failure, and was not linked. Linked books and failed books are never added.
    - If `code` differs from the current hash, all entries are dropped.
    - A missing file is an empty cache. A file that is not valid JSON exits `2` before any network call.
    - The file is written once at the end of the run, also after a failure that stops the run.
    - Each reader summary adds `skipped`: the number of skipped cards and genre rows.
  - **Dry run.** These flags do not change the dry run.
- **Errors.** A failure on one book is counted and skipped. A failure to get credentials or a session stops with exit `2`, naming the step but no secret.
- **Dry run.** The default is a dry run: it gets the keys, lists the readers and prints the "before" counts, read-only, with no sessions and no function calls. `--apply` runs the steps.
- **Failure details (S21).** Every failed book is printed as one JSON line `{ "failed": { "title", "step", "function", "status", "message" } }`: `step` is recommendations, localize, genre-hint or details; `status` is the HTTP status or null; `message` is cut to 200 characters with any token-like string (`eyJ…`) replaced by `[redacted]`. Per-reader totals are as before.

**`npm run requeue:not-found`** (`scripts/requeue-not-found.ts`, S26): puts unresolved editions back in the resolver queue.
- It lists every positive-ID edition with `resolve_status` `not_found` and `work_id` null that is on any reader's shelf, recommendation or genre row.
- The default is a dry run with a read-only connection. It prints one JSON line per edition (`simania_id`, `title`, `author`), then `{ "total": n }`.
- `--apply` sets those editions to `resolve_status` `pending` and `resolved_at` null, and prints the same lines and `{ "requeued": n }`. It changes nothing else.
- The operator runs it after a resolver change is deployed, then runs `refresh:all -- --apply`.
- `--simania <id>` selects that edition when it has `resolve_status` `not_found` and null `work_id`, even when no shelf, recommendation or genre row references it. Without `--simania`, the referenced-edition selection above is unchanged.

**`npm run series:links`** (`scripts/series-links.ts`, S30): links unresolved series editions by their series position. Dry run by default, `--apply` to write, `--simania <id>` for one edition. It holds no book-, series- or author-specific constants. Example: `השביעיה הסודית` #3, #4, #6, #14; edition #4 is linked to a Hardcover book whose `book_series` row has `position` 4 in Hardcover series 10178.
- **Targets.** Positive editions with `resolve_status` `not_found`, `work_id` null and a non-empty `series`, which a shelf, recommendation or genre row references. With `--simania`, only that one, referenced or not.
- **Target number.** The Simania `seriesNumber` from `bookDetails`. It must be a positive integer string, else the target is skipped with reason `no_number`.
- **Anchors.** Linked positive editions whose trimmed `series` equals the target's and whose author agrees with the target's: equal after removing Hebrew points and parentheses, or `similarity >= 0.6`. Each needs an integer `seriesNumber` from `bookDetails`. For each anchor, read its work's `book_series` rows (`book_series(where:{book_id:{_eq:<id>}}){ position series_id }`).
- **The Hardcover series.** A Hardcover series `S` is accepted when at least one anchor has a row in `S` whose `position` equals its Simania number, and no anchor has a row in `S` with a different position (reason `anchor_disagrees`). More than one accepted series gives reason `ambiguous_series`; none gives `no_anchor`.
- **The book.** Read the books at position `M` (the target's number) in `S` (`book_series(where:{series_id:{_eq:<id>}, position:{_eq:<n>}}){ book_id book { id title slug users_read_count compilation cached_contributors cached_similar_book_ids cached_tags image { url } } }`). One position can hold several books: several editions of one title, and sometimes a wrong one (position 14 has `Look Out, Secret Seven` with 26 readers and `The Secret Seven` with 1). Drop compilations and books with no contributor whose name has Dice greater than `0.45` with some anchor work's `original_authors`. Then take the book with the most `users_read_count`. Accept it only when it has at least `5`, and at least 3 times the readers of every remaining book whose title has Dice below `0.8` with its title. Otherwise the reason is `ambiguous_book` or `no_book`.
- **Output.** One JSON line per target: `simania_id`, `title`, `series`, `number`, `anchors` (`simania_id`, `number`, `position`), `series_id`, then `proposal` (`hardcover_id`, `title`, `users_read_count`) or `reason`. Then `{ "proposals": n, "skipped": n }`.
- **`--apply`.** In one transaction per proposal: upsert the work as `repair:links` does, then set `work_id`, `resolve_status = 'series'` and `resolved_at = now()` only where `work_id` is still null. Then print `{ "linked": n }`.
- **Hardcover budget.** It runs the same Hardcover budget check as `refresh:all` (`--min-hardcover`, default `1500`; `--force-hardcover`; exit `4`). It makes requests one at a time.
- **Review.** The operator reviews every proposal before `--apply`. As with `report:omnibus`, `series` links can be listed by status.

**`npm run recheck:links`** (`scripts/recheck-links.ts`, S31): rechecks existing automatic links with the current resolver rules. It holds no book-, series- or author-specific constants.
- **Scope.** Positive editions with `work_id` set and `resolve_status` `wikidata`, `nli` or `fuzzy`, whose work is used (shelf, recommendation or genre row). With `--all`, every such edition. With `--simania <id>`, one edition.
- **Check.** For each edition, run the resolver's decision (`resolveMatch`, below) without writing.
  - When it accepts a Hardcover book whose ID differs from the current work's `hardcover_id`, print a `relink` line: `simania_id`, `title`, from `hardcover_id`/`original_title`, to `hardcover_id`/`title`, new `status`.
  - When it accepts nothing for a box set, print an `unlink` line.
  - Otherwise print nothing for the edition.
  - Then print `{ "checked": n, "relinks": n, "unlinks": n }`.
- **`--apply`.** Relink through `repair:links`' relink transaction, with the new status, only where `work_id` still equals the old work's ID. An unlink sets `work_id` null, `resolve_status` `not_found` and `resolved_at` now, only where `work_id` still equals the old ID. It prints `{ "relinked": n, "unlinked": n, "skipped": n }`.
- **Hardcover budget.** The same check as `refresh:all` (`--min-hardcover`, default `1500`; `--force-hardcover`; exit `4`). Requests are sequential.
- **Review.** The operator reviews every line before `--apply`.
- **`resolveMatch(edition, providers)`.** Exported from the resolver: the full Wikidata → NLI → fuzzy decision with no database write. It returns `{ book, status }` or `null`, with the same provider-failure behavior. `ensureResolved` uses it.

### `link-edition`

Request `LinkEditionRequest`: `{"work_id":"78e9c71d-d6f2-4ea4-bcbb-42e4ec9300cf","simania_id":1234,"source":"wikidata","simania":{"details":{"title":"ספר"},"rating":null}}`. Response `LinkEditionResponse`: `{"work_id":"78e9c71d-...","simania_id":1234,"title":"ספר","author":null,"cover_url":null}`; the browser applies it to the card, which becomes `english_only: false, can_add: true`.

`source` must be `wikidata`, `nli`, `nli_author` or `omnibus`, and `simania` is required (`400` otherwise). Store `source` as the edition's `resolve_status`, including `nli_author` and `omnibus`. The caller must have a non-dismissed recommendation row or a `genre_recommendations` row for `work_id` (`404` otherwise). Everything below that names the caller's recommendation row applies equally to the caller's genre row for `work_id`: on success, each of the two rows that exists gets the `simania_id` (or is deleted under the "already on your shelves" rule). Store the edition from `simania` with the 30-day rule, then apply the linking rules above: claim the row only while `work_id` is null (conditional update), keep an existing link to the same work with its metadata, and answer `409` when the edition is linked to a different work (never relink). On success, if the linked edition, or any edition of `work_id`, is on one of the caller's shelves, delete the caller's non-dismissed recommendation row for `work_id` and answer `409` with `{"error":"Already on your shelves."}` (a book the reader owns must never be recommended back); otherwise set the caller's recommendation `simania_id` with the service client.

## View models

### `BookCard`

No external-site URL is included.

| Field | Type | Exact source |
|---|---|---|
| `simania_id` | `number` | `editions.simania_id` (negative for an English edition) |
| `english_edition` | `boolean` | `simania_id < 0` |
| `work_id` | `string \| null` | `editions.work_id` |
| `resolve_status` | `ResolveStatus` | `editions.resolve_status` |
| `title` | `string` | `editions.title` |
| `author` | `string \| null` | `editions.author` |
| `translator` | `string \| null` | `editions.translator` |
| `publisher` | `string \| null` | `editions.publisher` |
| `series` | `string \| null` | `editions.series` |
| `category` | `string \| null` | `editions.category` |
| `year` | `number \| null` | `editions.year` |
| `pages` | `number \| null` | `editions.pages` |
| `description` | `string \| null` | `editions.description` |
| `cover_url` | `string \| null` | `editions.cover_url` |
| `simania_rating` | `number \| null` | numeric `editions.simania_rating` serialized as number |
| `simania_rating_count` | `number \| null` | `editions.simania_rating_count` |
| `shelf_id` | `string \| null` | caller's `shelf_books.shelf_id`, else null |
| `shelf_name` | `string \| null` | joined `shelves.name`, else null |
| `shelf_kind` | `ShelfKind \| null` | joined `shelves.kind`, else null |
| `position` | `number \| null` | caller's `shelf_books.position`, else null |
| `added_at` | `string \| null` | caller's `shelf_books.added_at`, else null |
| `finished_at` | `string \| null` | caller's `shelf_books.finished_at`, else null |
| `rating` | `number \| null` | caller's `shelf_books.rating`, else null; unused by scoring. On the reader's own shelves, a tile with a non-null rating shows it as a row of 5 small stars just above the cover (in the row's top padding, as wide as the cover, `rating` filled from the right); an unrated tile shows nothing |

### `GenreShelf` and `GenreBook`

`GenreShelf` is `{ genre_key, genre, pinned, books }` ordered by `shelf_position` (`pinned` is true when the caller's `genre_preferences` pins that key; an empty pinned shelf from "Reading them" has `books: []`); `books` ordered by `position`. `GenreBook`: `work_id`; `hardcover_id` = `works.hardcover_id`; `simania_id`; `title` = edition title, else `works.original_title`; `author` = edition author, else `works.original_authors` joined with `, ` (null if empty); `cover_url` = edition cover, else `works.hardcover_cover_url`; `english_only` = `simania_id === null`; `because` = `genre_recommendations.because`; `because_titles` = the exact edition title for each `because` ID, same order, unknown IDs skipped (the same lookup as `RecommendationCard.because_titles`).

### `RecommendationCard`

| Field | Type | Exact source / computation |
|---|---|---|
| `work_id` | `string` | `recommendations.work_id` |
| `hardcover_id` | `number` | `works.hardcover_id` |
| `simania_id` | `number \| null` | `recommendations.simania_id` |
| `title` | `string` | edition title; English-only `works.original_title` |
| `author` | `string \| null` | edition author; English-only authors joined with `, `, null if empty |
| `cover_url` | `string \| null` | edition cover; English-only `works.hardcover_cover_url` |
| `score` | `number` | `recommendations.score` |
| `because` | `number[]` | `recommendations.because` |
| `because_titles` | `string[]` | exact edition title for each `because` ID, same order |
| `shared_tags` | `string[]` | `recommendations.shared_tags` |
| `dismissed` | `boolean` | `recommendations.dismissed` |
| `generated_at` | `string` | `recommendations.generated_at` |
| `english_only` | `boolean` | `simania_id === null` |
| `can_add` | `boolean` | always `true`: a card with `simania_id` is added with that edition; an English-only card is added as its English edition with `add-book { hardcover_id }` |
| `hebrew_hint` | `HebrewHint \| null` | English-only cards only: the bridge's Hebrew title for the browser's Simania match; not stored |
| `hebrew_author` | `string \| null` | English-only cards only: the author's Hebrew name for the browser's Simania author search; not stored |

## Web modules and ownership

Each native screen module exports `mount(root, ctx)`, with an `HTMLElement` root and `{ api, data, router, card }`. It renders inside root, installs only its listeners, and may return cleanup; the router calls cleanup before another route. Pure ordering/mapping/debounce helpers are named exports with no DOM access at import.

Routes are exactly `#library`, `#recs`, `#search`, `#settings`, `#login`. Empty/unknown authenticated routes redirect to library; unauthenticated routes redirect to login. `public/js/contract.js` owns `SHELF_KINDS`, function names, routes, and RPC names/parameter names.

| Lane | Exclusive files after shell creation |
|---|---|
| S1-T4 shell/library/card | `index.html`, `css/base.css`, shared CSS stubs, `assets/**`, `js/config.js`, `api.js`, `data.js`, `router.js`, `library.js`, `card.js`, `main.js`; creates later JS stubs only |
| S1-T6 login/settings | `js/auth.js`, `settings.js`, `css/auth.css`, `settings.css` |
| S1-T7 recommendations | `js/recs.js`, `css/recs.css` |
| S1-T8 add/search | `js/add-book.js`, `css/add-book.css` |
| S1-T9 first-run/PWA | `js/first-run.js`, `css/first-run.css`, `manifest.webmanifest`, `icons/**` |

Feature lanes do not edit shared routing, data access, `index.html`, or other lanes' files. UI is RTL Hebrew, supports keyboard/touch, has loading/error states, rolls back failed optimistic writes, and respects reduced motion.

**Swipe to close the book card (phone only).** At the phone layout (`max-width: 640px`, where the card is a bottom sheet) with touch input: when the card is scrolled to its top and a touch starts on the card and moves downward, the sheet follows the finger. On release, it closes through the card's normal close if the drag passed 90px or was a quick flick (at least 0.5 px/ms over at least 30px); otherwise it springs back. A drag that starts while the card is scrolled down just scrolls, as now. Taps, the shelf select, star ratings and horizontal moves are unaffected. There is no swipe on wider layouts or with a mouse. With reduced motion, the spring-back and close are immediate.
